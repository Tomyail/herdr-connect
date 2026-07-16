package daemoncli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/Tomyail/herdr-connect/internal/demolan"
	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/projection"
	"github.com/Tomyail/herdr-connect/internal/store"
)

type SourceFactory func(string) (herdrsource.Source, error)

func Execute(ctx context.Context, args []string, stdout, stderr io.Writer, sourceFactory SourceFactory) int {
	flags := flag.NewFlagSet("herdr-connect", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", defaultDBPath(), "SQLite 数据库路径")
	sourceName := flags.String("source", "herdr", "Herdr Source: herdr 或 fake")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	remaining := flags.Args()
	if len(remaining) == 0 {
		fmt.Fprintln(stderr, "用法: herdr-connect [--db PATH] [--source herdr|fake] <status|agents|capabilities|diagnostics|migrations|trace|daemon|demo-lan>")
		return 2
	}
	command := remaining[0]
	if command == "migrations" {
		database, err := store.Open(ctx, *dbPath)
		if err != nil {
			return printError(stderr, err)
		}
		defer database.Close()
		return writeJSON(stdout, map[string]any{"database": *dbPath, "schema_version": database.SchemaVersion()})
	}

	source, err := sourceFactory(*sourceName)
	if err != nil {
		return printError(stderr, err)
	}
	if command == "capabilities" {
		caps, err := source.Capabilities(ctx)
		if err != nil {
			return printError(stderr, err)
		}
		return writeJSON(stdout, caps)
	}
	if command == "demo-lan" {
		fmt.Fprintln(stderr, "警告：demo-lan 无认证、无加密，仅用于受控局域网演示。")
		if err := demolan.Serve(ctx, demolan.DefaultAddress, source); err != nil {
			return printError(stderr, err)
		}
		return 0
	}

	database, err := store.Open(ctx, *dbPath)
	if err != nil {
		return printError(stderr, err)
	}
	defer database.Close()
	projector := projection.New(database)

	switch command {
	case "status", "agents", "diagnostics":
		state, syncErr := projector.Sync(ctx, source)
		if syncErr != nil {
			if command == "agents" {
				return printError(stderr, syncErr)
			}
			caps, err := source.Capabilities(ctx)
			if err != nil {
				return printError(stderr, err)
			}
			state, err = projector.Load(ctx, source.Name(), false, caps)
			if err != nil {
				return printError(stderr, err)
			}
		}
		switch command {
		case "agents":
			return writeJSON(stdout, state.Agents)
		case "diagnostics":
			diagnostics := map[string]any{
				"database":          *dbPath,
				"schema_version":    database.SchemaVersion(),
				"source_name":       state.SourceName,
				"source_online":     state.SourceOnline,
				"agent_count":       len(state.Agents),
				"through_event_seq": state.ThroughEventSeq,
			}
			if syncErr != nil {
				diagnostics["source_error"] = "source_unavailable"
			}
			return writeJSON(stdout, diagnostics)
		default:
			return writeJSON(stdout, state)
		}
	case "trace":
		return runTrace(ctx, stdout, stderr, source, projector)
	case "daemon":
		once := len(remaining) > 1 && remaining[1] == "--once"
		return runDaemon(ctx, stdout, stderr, source, projector, once)
	default:
		fmt.Fprintf(stderr, "未知命令 %q\n", command)
		return 2
	}
}

func runTrace(ctx context.Context, stdout, stderr io.Writer, source herdrsource.Source, projector *projection.Projector) int {
	fake, ok := source.(*herdrsource.Fake)
	if !ok {
		return printError(stderr, fmt.Errorf("trace 只支持 fake Herdr Source"))
	}
	states := make([]projection.State, 0, 4)
	state, err := projector.Sync(ctx, fake)
	if err != nil {
		return printError(stderr, err)
	}
	states = append(states, state)
	steps := []struct {
		state   herdrsource.InteractionState
		outcome *herdrsource.TurnOutcome
	}{
		{state: herdrsource.InteractionBlocked},
		{state: herdrsource.InteractionReadyInput},
		{state: herdrsource.InteractionUnknown, outcome: outcome(herdrsource.OutcomeSucceeded)},
	}
	for index, step := range steps {
		revision := uint64(index + 2)
		fake.Append(herdrsource.ChangeBatch{
			AfterCursor: fmt.Sprintf("%d", revision),
			Changes: []herdrsource.Change{{Kind: herdrsource.ChangeUpsert, Agent: herdrsource.AgentObservation{
				SourceID:         "fake-agent-1",
				DisplayName:      "Fake Agent",
				TurnID:           "turn-1",
				Revision:         revision,
				InteractionState: step.state,
				TurnOutcome:      step.outcome,
			}}},
		})
		state, err = projector.Sync(ctx, fake)
		if err != nil {
			return printError(stderr, err)
		}
		states = append(states, state)
	}
	return writeJSON(stdout, map[string]any{"tracer": "complete", "states": states})
}

func runDaemon(ctx context.Context, stdout, stderr io.Writer, source herdrsource.Source, projector *projection.Projector, once bool) int {
	for {
		state, err := projector.Sync(ctx, source)
		if err != nil {
			fmt.Fprintln(stderr, "source_unavailable")
			caps, capsErr := source.Capabilities(ctx)
			if capsErr == nil {
				if offline, loadErr := projector.Load(ctx, source.Name(), false, caps); loadErr == nil {
					_ = json.NewEncoder(stdout).Encode(map[string]any{
						"source_online": offline.SourceOnline, "agent_count": len(offline.Agents), "through_event_seq": offline.ThroughEventSeq,
					})
				}
			}
		} else if err := json.NewEncoder(stdout).Encode(map[string]any{
			"source_online": state.SourceOnline, "agent_count": len(state.Agents), "through_event_seq": state.ThroughEventSeq,
		}); err != nil {
			return 1
		}
		if once {
			if err != nil {
				return 1
			}
			return 0
		}
		select {
		case <-ctx.Done():
			return 0
		case <-time.After(2 * time.Second):
		}
	}
}

func outcome(value herdrsource.TurnOutcome) *herdrsource.TurnOutcome { return &value }

func writeJSON(writer io.Writer, value any) int {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return 1
	}
	return 0
}

func printError(stderr io.Writer, err error) int {
	fmt.Fprintf(stderr, "error: %v\n", err)
	return 1
}

func defaultDBPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "herdr-connect.db"
	}
	return filepath.Join(dir, "herdr-connect", "daemon.db")
}
