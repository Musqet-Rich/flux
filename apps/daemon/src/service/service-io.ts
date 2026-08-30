// The side effects `flux service install` needs, injected so install, uninstall and status are
// unit-tested with fakes: which files they would write or remove and which `systemctl`/`launchctl`
// commands they would run, per host and root vs non-root, without touching a real init system.
// `run` resolves with the command's exit — a non-zero exit is data, not a throw — so status can
// read it and install can decide to fail; a missing binary is the one thing `run` rejects.

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ServiceIo {
  exists: (path: string) => boolean;
  writeFile: (path: string, content: string, mode: number) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  mkdirp: (path: string) => Promise<void>;
  run: (argv: readonly string[]) => Promise<CommandResult>;
}
