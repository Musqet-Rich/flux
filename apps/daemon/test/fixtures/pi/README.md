# pi fixtures

Raw stdout of `pi --mode rpc`, exactly as emitted, one file per run. Captured on 2026-08-29 with pi 0.84.4 under `--provider anthropic --model claude-haiku-4-5 --thinking off` (thinking off because signed thinking blocks are opaque base64 the repo's secret scanner refuses; the daemon leaves thinking to pi's settings and the parser ignores thinking events). Never edit these by hand; re-capture with `capture.ts` when pi changes shape (engineering.md § Testing).

| file               | prompt                                                                                                                                                                            | notes                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `text-reply.jsonl` | `Reply with exactly the word: pong`                                                                                                                                               | session id `11111111-…`, new                                                                                                             |
| `tools.jsonl`      | `Read notes.txt in the current directory, then run \`ls\` with bash. Then reply in one short sentence with what you found.`                                                       | cwd holds `notes.txt`; a `read` and a `bash` call run in parallel                                                                        |
| `flux-tools.jsonl` | `Call flux_notify with summary 'starting' and level 'info'. Then call flux_ask with question 'Red or blue?' and options ['red','blue']. Reply with just the answer you received.` | the Flux extension loaded; a fake control socket answered `blue`                                                                         |
| `interrupt.jsonl`  | `Write the numbers from 1 to 300, one per line, and nothing else.`                                                                                                                | `{"type":"abort"}` sent at the first `text_delta`; the model had already called `write`                                                  |
| `resume.jsonl`     | `What single word did you reply with earlier in this conversation? Answer with just that word.`                                                                                   | same `--session-id` as `text-reply`, a new process: pi resumed the session file                                                          |
| `bad-model.jsonl`  | `hi`                                                                                                                                                                              | `--model no-such-model`; pi exits 0, the failure is an assistant message with `stopReason: error`; `bad-model.stderr.txt` is pi's stderr |

Every run was started as the daemon starts pi (`src/pi/spawn-pi.ts`):

```
pi --mode rpc --provider anthropic --model claude-haiku-4-5 \
   --session-dir <dir> --session-id <uuid> --no-approve --thinking off \
   --extension apps/daemon/src/pi/flux-pi-extension.ts \
   --append-system-prompt "<the Flux prompt from spawn-pi.ts>"
```

with `FLUX_CONTROL_SOCKET` pointing at the fake socket and `FLUX_SESSION=fixture` in the environment. Each run cost well under a cent; all six together were about 3 cents.

## Re-capturing

```
node apps/daemon/test/fixtures/pi/capture.ts <scenario> <outDir>
```

`scenario` is one of the file stems above. Set `FLUX_CAPTURE_DIR` to reuse one working directory across runs: `resume` needs `text-reply` to have run first into the same session dir. The script spawns pi, answers the control socket, writes `<scenario>.jsonl`, `<scenario>.stderr.txt` and `<scenario>.meta.json` (exit code and arguments) to `outDir`; copy the `.jsonl` and `.meta.json` here (the meta file records pi's exit code, signal and the non-path arguments, so the notes above are checked in, not remembered) and update the version and date above. It needs `pi` on PATH and `pi auth check --provider anthropic` to say `ready`.
