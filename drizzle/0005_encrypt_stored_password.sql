-- Apr-17 security cluster, issue #5: plaintext stored_password becomes encrypted.
--
-- We do NOT decrypt or back-fill existing rows — dev-tier data is expendable
-- (parker's standing destructive-migrations rule). Every existing password is
-- nulled; affected users will hit the normal stale-credential UI and can
-- re-link via /api/user/credentials/reconnect after the migration lands.
--
-- No column shape change; the column type stays TEXT. Going forward all
-- writes flow through `encryptStoredPassword` (AES-256-GCM envelope) and all
-- reads through `decryptStoredPassword`.

UPDATE `user_service_credentials` SET `stored_password` = NULL;
