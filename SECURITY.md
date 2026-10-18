# Security

## Reporting a problem

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/ychampion/kappa-bench/security/advisories/new), not in
a public issue. We aim to reply within three working days.

Report, for example:

- a way for a bot under test to read or change the bench's credentials, results or another bot's state;
- a way to get around the metering proxy's spend cap;
- a transcript or result file in this repository that contains a secret or personal data.

## How the bench handles secrets

- Credentials come only from environment variables at run time. Nothing in `bots/*.json` is a secret.
- The real model key lives only in the metering proxy; bots and the grader get a placeholder.
- Published transcripts are checked for keys, tokens, hostnames, IP addresses, local paths and email
  addresses before they are committed. Test data in tasks (names, codes, passwords) is invented.
- Ordinary tasks never ask a bot to act outside its own workspace, and the approval policy denies anything
  outward. Run bots on machines with no real accounts connected.

## Held-out tasks

The private held-out task set is not in this repository. Please do not try to obtain it or post its tasks.
