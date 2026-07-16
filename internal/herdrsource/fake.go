package herdrsource

import (
	"context"
	"fmt"
	"sync"
)

type Fake struct {
	mu       sync.RWMutex
	name     string
	caps     Capabilities
	snapshot Snapshot
	batches  map[string]ChangeBatch
}

func NewFake(name string, caps Capabilities, snapshot Snapshot) *Fake {
	return &Fake{name: name, caps: caps, snapshot: snapshot, batches: make(map[string]ChangeBatch)}
}

func (f *Fake) Name() string { return f.name }

func (f *Fake) Snapshot(context.Context) (Snapshot, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return cloneSnapshot(f.snapshot), nil
}

func (f *Fake) Capabilities(context.Context) (Capabilities, error) { return f.caps, nil }

func (f *Fake) Append(batch ChangeBatch) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.batches[f.snapshot.Cursor] = batch
	f.snapshot.Cursor = batch.AfterCursor
	for _, change := range batch.Changes {
		f.apply(change)
	}
}

func (f *Fake) Changes(_ context.Context, cursor string) (ChangeBatch, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	batch, ok := f.batches[cursor]
	if !ok {
		return ChangeBatch{}, fmt.Errorf("cursor %q 不可用", cursor)
	}
	batch.Changes = append([]Change(nil), batch.Changes...)
	return batch, nil
}

func (f *Fake) apply(change Change) {
	for i := range f.snapshot.Agents {
		if f.snapshot.Agents[i].SourceID != change.Agent.SourceID {
			continue
		}
		if change.Kind == ChangeRemove {
			f.snapshot.Agents = append(f.snapshot.Agents[:i], f.snapshot.Agents[i+1:]...)
		} else {
			f.snapshot.Agents[i] = change.Agent
		}
		return
	}
	if change.Kind == ChangeUpsert {
		f.snapshot.Agents = append(f.snapshot.Agents, change.Agent)
	}
}

func cloneSnapshot(snapshot Snapshot) Snapshot {
	snapshot.Agents = append([]AgentObservation(nil), snapshot.Agents...)
	return snapshot
}
