# Private test credentials

On the machine where the Luna agent will run, save this outside the repository at `~/.known-enough/e2e-credentials.json`:

```json
{
  "users": [
    {"username": "test01", "password": "REPLACE_LOCALLY"},
    {"username": "test02", "password": "REPLACE_LOCALLY"}
  ]
}
```

Use dedicated synthetic, verified accounts with app access. Set directory permissions to 0700 and file permissions to 0600. Do not paste actual passwords into chat or commit them. Give the agent only the local path, not credentials in its prompt. Never copy credentials to another worker/account or assume this local file is available remotely; the owner prepares it on the execution machine.

Read the file privately without printing its contents or putting passwords into shell commands, logs or screenshots. Keep two browser profiles/contexts separate. Reports use User 1/User 2 aliases; do not publish passwords, tokens, private real-person data or invitation links. If accounts are unavailable or not approved, record the precise prerequisite; do not bypass admission or request another person's AWS credentials.
