package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	"github.com/Tomyail/herdr-connect/internal/daemoncli"
	"github.com/Tomyail/herdr-connect/internal/herdrsource"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	os.Exit(daemoncli.Execute(ctx, os.Args[1:], os.Stdout, os.Stderr, sourceFactory))
}

func sourceFactory(name string) (herdrsource.Source, error) {
	switch name {
	case "herdr":
		return herdrsource.NewHerdrCLIAdapter(herdrsource.ExecRunner{}), nil
	case "fake":
		return herdrsource.NewFake("fake", herdrsource.Capabilities{
			ObserveAgents:           true,
			IncrementalChanges:      true,
			TrustedInteractionState: true,
			TrustedTurnOutcome:      true,
			ReadOutput:              true,
			SendPrompt:              true,
			Interrupt:               true,
		}, herdrsource.Snapshot{
			Online: true,
			Cursor: "1",
			Agents: []herdrsource.AgentObservation{{
				SourceID:         "fake-agent-1",
				DisplayName:      "Fake Agent",
				TurnID:           "turn-1",
				Revision:         1,
				InteractionState: herdrsource.InteractionWorking,
			}},
		}), nil
	default:
		return nil, fmt.Errorf("未知 Herdr Source %q", name)
	}
}
