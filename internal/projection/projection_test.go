package projection_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/projection"
	"github.com/Tomyail/herdr-connect/internal/store"
)

func Test重复乱序和重启不会回退Agent或事件序列(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "daemon.db")
	caps := herdrsource.Capabilities{
		ObserveAgents:           true,
		TrustedInteractionState: true,
		TrustedTurnOutcome:      true,
	}
	fake := herdrsource.NewFake("fake", caps, herdrsource.Snapshot{
		Online: true,
		Cursor: "2",
		Agents: []herdrsource.AgentObservation{{
			SourceID:         "source-1",
			TurnID:           "turn-1",
			Revision:         2,
			InteractionState: herdrsource.InteractionBlocked,
		}},
	})

	firstStore, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	first := projection.New(firstStore)
	state, err := first.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("首次同步: %v", err)
	}
	if state.ThroughEventSeq != 1 || len(state.Agents) != 1 {
		t.Fatalf("首次投影 = %#v", state)
	}
	agentID := state.Agents[0].AgentID

	state, err = first.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("重复同步: %v", err)
	}
	if state.ThroughEventSeq != 1 || state.Agents[0].LifecycleRevision != 1 {
		t.Fatalf("重复观察产生了新事实: %#v", state)
	}

	fake.Append(herdrsource.ChangeBatch{AfterCursor: "1", Changes: []herdrsource.Change{{
		Kind: herdrsource.ChangeUpsert,
		Agent: herdrsource.AgentObservation{
			SourceID:         "source-1",
			TurnID:           "turn-old",
			Revision:         1,
			InteractionState: herdrsource.InteractionWorking,
		},
	}}})
	state, err = first.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("乱序同步: %v", err)
	}
	if state.ThroughEventSeq != 1 || state.Agents[0].InteractionState != herdrsource.InteractionBlocked {
		t.Fatalf("乱序观察覆盖了当前事实: %#v", state)
	}
	if err := firstStore.Close(); err != nil {
		t.Fatalf("关闭首次数据库: %v", err)
	}

	outcome := herdrsource.OutcomeSucceeded
	fake.Append(herdrsource.ChangeBatch{AfterCursor: "3", Changes: []herdrsource.Change{{
		Kind: herdrsource.ChangeUpsert,
		Agent: herdrsource.AgentObservation{
			SourceID:         "source-1",
			TurnID:           "turn-2",
			Revision:         3,
			InteractionState: herdrsource.InteractionReadyInput,
			TurnOutcome:      &outcome,
		},
	}}})
	secondStore, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("重启数据库: %v", err)
	}
	t.Cleanup(func() { _ = secondStore.Close() })
	state, err = projection.New(secondStore).Sync(ctx, fake)
	if err != nil {
		t.Fatalf("重启后同步: %v", err)
	}
	if state.ThroughEventSeq != 2 || state.Agents[0].LifecycleRevision != 2 {
		t.Fatalf("重启后序列未连续: %#v", state)
	}
	if state.Agents[0].AgentID != agentID {
		t.Fatalf("重启后 agent_id = %q, want %q", state.Agents[0].AgentID, agentID)
	}
}

func Test能力缺失时投影强制使用未知语义(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	outcome := herdrsource.OutcomeFailed
	fake := herdrsource.NewFake("limited", herdrsource.Capabilities{ObserveAgents: true}, herdrsource.Snapshot{
		Online: true,
		Agents: []herdrsource.AgentObservation{{
			SourceID:         "source-1",
			Revision:         1,
			InteractionState: herdrsource.InteractionBlocked,
			TurnOutcome:      &outcome,
		}},
	})

	state, err := projection.New(db).Sync(ctx, fake)
	if err != nil {
		t.Fatalf("同步: %v", err)
	}
	if state.Agents[0].InteractionState != herdrsource.InteractionUnknown || state.Agents[0].TurnOutcome != nil {
		t.Fatalf("不可信事实未被收敛: %#v", state.Agents[0])
	}
}

func Test增量变化处理新增更新关闭并持久保存Cursor(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "daemon.db")
	db, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	caps := herdrsource.Capabilities{ObserveAgents: true, IncrementalChanges: true, TrustedInteractionState: true}
	fake := herdrsource.NewFake("fake", caps, herdrsource.Snapshot{
		Online: true,
		Cursor: "1",
		Agents: []herdrsource.AgentObservation{
			{SourceID: "source-1", Revision: 1, InteractionState: herdrsource.InteractionWorking},
			{SourceID: "source-2", Revision: 1, InteractionState: herdrsource.InteractionWorking},
		},
	})
	projector := projection.New(db)
	if _, err := projector.Sync(ctx, fake); err != nil {
		t.Fatalf("同步快照: %v", err)
	}
	fake.Append(herdrsource.ChangeBatch{AfterCursor: "2", Changes: []herdrsource.Change{
		{Kind: herdrsource.ChangeUpsert, Agent: herdrsource.AgentObservation{SourceID: "source-1", Revision: 2, InteractionState: herdrsource.InteractionBlocked}},
		{Kind: herdrsource.ChangeRemove, Agent: herdrsource.AgentObservation{SourceID: "source-2", Revision: 2}},
	}})

	state, err := projector.ApplyChanges(ctx, fake, "1")
	if err != nil {
		t.Fatalf("应用增量: %v", err)
	}
	if len(state.Agents) != 1 || state.Agents[0].InteractionState != herdrsource.InteractionBlocked || state.ThroughEventSeq != 4 {
		t.Fatalf("增量投影 = %#v", state)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("关闭数据库: %v", err)
	}

	reopened, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("重开数据库: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	cursor, err := reopened.SourceCursor(ctx, "fake")
	if err != nil {
		t.Fatalf("读取 cursor: %v", err)
	}
	if cursor != "2" {
		t.Fatalf("cursor = %q, want 2", cursor)
	}
}

func Test权威快照关闭缺失Agent且重新出现时保持稳定ID(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	caps := herdrsource.Capabilities{ObserveAgents: true, IncrementalChanges: true, TrustedInteractionState: true}
	fake := herdrsource.NewFake("fake", caps, herdrsource.Snapshot{Online: true, Cursor: "1", Agents: []herdrsource.AgentObservation{{
		SourceID: "source-1", Revision: 1, InteractionState: herdrsource.InteractionWorking,
	}}})
	projector := projection.New(db)
	state, err := projector.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("同步初始快照: %v", err)
	}
	agentID := state.Agents[0].AgentID
	fake.Append(herdrsource.ChangeBatch{AfterCursor: "2", Changes: []herdrsource.Change{{
		Kind: herdrsource.ChangeRemove, Agent: herdrsource.AgentObservation{SourceID: "source-1", Revision: 2},
	}}})
	state, err = projector.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("同步关闭快照: %v", err)
	}
	if len(state.Agents) != 0 || state.ThroughEventSeq != 2 {
		t.Fatalf("关闭快照 = %#v", state)
	}
	fake.Append(herdrsource.ChangeBatch{AfterCursor: "stale", Changes: []herdrsource.Change{{
		Kind: herdrsource.ChangeUpsert, Agent: herdrsource.AgentObservation{SourceID: "source-1", Revision: 1, InteractionState: herdrsource.InteractionWorking},
	}}})
	state, err = projector.ApplyChanges(ctx, fake, "2")
	if err != nil {
		t.Fatalf("应用关闭后的迟到观察: %v", err)
	}
	if len(state.Agents) != 0 || state.ThroughEventSeq != 2 {
		t.Fatalf("迟到观察复活了已关闭 Agent: %#v", state)
	}
	fake.Append(herdrsource.ChangeBatch{AfterCursor: "3", Changes: []herdrsource.Change{{
		Kind: herdrsource.ChangeUpsert, Agent: herdrsource.AgentObservation{SourceID: "source-1", Revision: 3, InteractionState: herdrsource.InteractionUnknown},
	}}})
	state, err = projector.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("同步重新出现快照: %v", err)
	}
	if len(state.Agents) != 1 || state.Agents[0].AgentID != agentID || state.ThroughEventSeq != 3 {
		t.Fatalf("重新出现快照 = %#v", state)
	}
}

func Test来源Revision增加但领域事实未变时不产生事件(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	caps := herdrsource.Capabilities{ObserveAgents: true}
	fake := herdrsource.NewFake("limited", caps, herdrsource.Snapshot{Online: true, Cursor: "1", Agents: []herdrsource.AgentObservation{{
		SourceID: "source-1", Revision: 1, InteractionState: herdrsource.InteractionUnknown,
	}}})
	projector := projection.New(db)
	if _, err := projector.Sync(ctx, fake); err != nil {
		t.Fatalf("首次同步: %v", err)
	}
	fake.Append(herdrsource.ChangeBatch{AfterCursor: "2", Changes: []herdrsource.Change{{Kind: herdrsource.ChangeUpsert, Agent: herdrsource.AgentObservation{
		SourceID: "source-1", Revision: 2, InteractionState: herdrsource.InteractionWorking,
	}}}})
	state, err := projector.Sync(ctx, fake)
	if err != nil {
		t.Fatalf("同步无领域变化的来源 revision: %v", err)
	}
	if state.ThroughEventSeq != 1 || state.Agents[0].LifecycleRevision != 1 || state.Agents[0].InteractionState != herdrsource.InteractionUnknown {
		t.Fatalf("无领域变化却产生了新事件: %#v", state)
	}
}
