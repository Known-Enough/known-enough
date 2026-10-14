# FIX04 — Multiple test usernames for the selected email

The user requested one exact testing email exception. It permits multiple unique Cognito usernames for that verified address, without a per-email account counter. All other emails keep immutable single-owner registration. Overall service/resource limits still apply.

Every new username has a separate Cognito subject, private profile and PENDING admission. The exception neither approves users nor shares the original account, groups, private inputs or consent. Invitation links remain one-use and bind to the accepting subject; separately approved test accounts may join the same group explicitly. Existing confirmed usernames without a native account can recover automatically through normal sign-in/refresh. Existing approved/rejected/disabled records are preserved.

The selected address is a private GitHub configuration secret. The established compatible native publisher computes its HMAC using the existing private email key, adds only the allowed hash to `configuration-private.json`, updates the independent configuration anchor in `release-private.json`, and verifies the full candidate ZIP on actual publication. It preserves all original keys, identities, migration records, environment and managed packages. Future compatible publications preserve/reassert this setting. The permission-denied environment-write attempt is historical evidence; no new IAM grant or CloudShell setup is required by this approach.

Subject-specific immutable email claims use the existing EMAIL key prefix. The original global claim is untouched. The native operator verifies the current provider subject/verified email and the correct immutable claim before approving a selected exact username; public snapshots never carry hashes or the private shared-email marker.

Source tests cover repeated registration beyond the earlier one-email rule, ordinary-email denial, trusted configuration/verified-subject requirements, immutable ownership, separate approval and one-use invitations. Live readback will compare the actual installed private config against the selected private secret before ordinary owned signup/approval regression tests. Human inboxes/passwords are not accessed and no human account is approved by the proof.

[Ticket](ticket.md) · [Current operator commands](commands.md)
