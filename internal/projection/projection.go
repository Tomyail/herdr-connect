package projection

import (
	"context"
	"fmt"
	"sync"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/store"
)

type Agent struct {
	AgentID           string                       `json:"agent_id"`
	SourceID          string                       `json:"source_id"`
	TurnID            string                       `json:"turn_id,omitempty"`
	LifecycleRevision uint64                       `json:"lifecycle_revision"`
	InteractionState  herdrsource.InteractionState `json:"interaction_state"`
	TurnOutcome       *herdrsource.TurnOutcome     `json:"turn_outcome,omitempty"`
}

type State struct {
	SourceName      string                   `json:"source_name"`
	SourceOnline    bool                     `json:"source_online"`
	Capabilities    herdrsource.Capabilities `json:"capabilities"`
	ThroughEventSeq uint64                   `json:"through_event_seq"`
	Agents          []Agent                  `json:"agents"`
}

type Projector struct {
	store *store.Store
	mu    sync.RWMutex
	state State
}

func New(database *store.Store) *Projector { return &Projector{store: database} }

func (p *Projector) Sync(ctx context.Context, source herdrsource.Source) (State, error) {
	caps, err := source.Capabilities(ctx)
	if err != nil {
		return State{}, fmt.Errorf("读取 Herdr Source 能力: %w", err)
	}
	snapshot, err := source.Snapshot(ctx)
	if err != nil {
		return State{}, fmt.Errorf("读取 Herdr Source 快照: %w", err)
	}
	if !caps.ObserveAgents {
		return State{}, fmt.Errorf("Herdr Source 未声明 observe_agents 能力")
	}
	observed := make(map[string]struct{}, len(snapshot.Agents))
	updates := make([]store.AgentUpdate, 0, len(snapshot.Agents))
	for _, observation := range snapshot.Agents {
		update, err := normalizeObservation(caps, observation)
		if err != nil {
			return State{}, fmt.Errorf("投影 Agent %q: %w", observation.SourceID, err)
		}
		updates = append(updates, update)
		observed[observation.SourceID] = struct{}{}
	}
	if err := p.store.ApplyProjectionBatch(ctx, store.ProjectionBatch{
		SourceName:            source.Name(),
		Cursor:                snapshot.Cursor,
		Updates:               updates,
		AuthoritativeSnapshot: snapshot.Online,
		ObservedSourceIDs:     observed,
	}); err != nil {
		return State{}, err
	}
	return p.buildState(ctx, source.Name(), snapshot.Online, caps)
}

func (p *Projector) ApplyChanges(ctx context.Context, source herdrsource.Source, cursor string) (State, error) {
	caps, err := source.Capabilities(ctx)
	if err != nil {
		return State{}, fmt.Errorf("读取 Herdr Source 能力: %w", err)
	}
	if !caps.IncrementalChanges {
		return State{}, fmt.Errorf("Herdr Source 未声明 incremental_changes 能力")
	}
	batch, err := source.Changes(ctx, cursor)
	if err != nil {
		return State{}, fmt.Errorf("读取 Herdr Source 增量: %w", err)
	}
	updates := make([]store.AgentUpdate, 0, len(batch.Changes))
	removals := make([]store.AgentRemoval, 0, len(batch.Changes))
	for _, change := range batch.Changes {
		switch change.Kind {
		case herdrsource.ChangeUpsert:
			update, err := normalizeObservation(caps, change.Agent)
			if err != nil {
				return State{}, err
			}
			updates = append(updates, update)
		case herdrsource.ChangeRemove:
			if change.Agent.SourceID == "" || change.Agent.Revision == 0 {
				return State{}, fmt.Errorf("Agent 关闭变化缺少稳定 source_id 或正 revision")
			}
			removals = append(removals, store.AgentRemoval{SourceID: change.Agent.SourceID, SourceRevision: change.Agent.Revision})
		default:
			return State{}, fmt.Errorf("未知 Herdr Source change kind %q", change.Kind)
		}
	}
	if err := p.store.ApplyProjectionBatch(ctx, store.ProjectionBatch{
		SourceName: source.Name(), Cursor: batch.AfterCursor, Updates: updates, Removals: removals,
	}); err != nil {
		return State{}, err
	}
	return p.buildState(ctx, source.Name(), true, caps)
}

func normalizeObservation(caps herdrsource.Capabilities, observation herdrsource.AgentObservation) (store.AgentUpdate, error) {
	if observation.SourceID == "" || observation.Revision == 0 {
		return store.AgentUpdate{}, fmt.Errorf("Herdr Source Agent 缺少稳定 source_id 或正 revision")
	}
	state := observation.InteractionState
	if !caps.TrustedInteractionState {
		state = herdrsource.InteractionUnknown
	}
	switch state {
	case herdrsource.InteractionWorking, herdrsource.InteractionBlocked, herdrsource.InteractionReadyInput, herdrsource.InteractionUnknown:
	default:
		return store.AgentUpdate{}, fmt.Errorf("未知 interaction_state %q", state)
	}
	var outcome *string
	if caps.TrustedTurnOutcome && observation.TurnOutcome != nil {
		switch *observation.TurnOutcome {
		case herdrsource.OutcomeSucceeded, herdrsource.OutcomeFailed, herdrsource.OutcomeCancelled:
		default:
			return store.AgentUpdate{}, fmt.Errorf("未知 turn_outcome %q", *observation.TurnOutcome)
		}
		value := string(*observation.TurnOutcome)
		outcome = &value
	}
	return store.AgentUpdate{SourceRevision: observation.Revision, Record: store.AgentRecord{
		SourceID: observation.SourceID, TurnID: observation.TurnID, InteractionState: string(state), TurnOutcome: outcome,
	}}, nil
}

func (p *Projector) buildState(ctx context.Context, sourceName string, online bool, caps herdrsource.Capabilities) (State, error) {
	records, err := p.store.ActiveAgents(ctx)
	if err != nil {
		return State{}, err
	}
	seq, err := p.store.CurrentEventSeq(ctx)
	if err != nil {
		return State{}, err
	}
	state := State{
		SourceName:      sourceName,
		SourceOnline:    online,
		Capabilities:    caps,
		ThroughEventSeq: seq,
		Agents:          make([]Agent, 0, len(records)),
	}
	for _, record := range records {
		if record.SourceName != sourceName {
			continue
		}
		var outcome *herdrsource.TurnOutcome
		if record.TurnOutcome != nil {
			value := herdrsource.TurnOutcome(*record.TurnOutcome)
			outcome = &value
		}
		state.Agents = append(state.Agents, Agent{
			AgentID:           record.AgentID,
			SourceID:          record.SourceID,
			TurnID:            record.TurnID,
			LifecycleRevision: record.LifecycleRevision,
			InteractionState:  herdrsource.InteractionState(record.InteractionState),
			TurnOutcome:       outcome,
		})
	}
	p.mu.Lock()
	p.state = state
	p.mu.Unlock()
	return state, nil
}

func (p *Projector) Current() State {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.state
}

func (p *Projector) Load(ctx context.Context, sourceName string, online bool, caps herdrsource.Capabilities) (State, error) {
	return p.buildState(ctx, sourceName, online, caps)
}
