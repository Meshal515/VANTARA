// The original migration seeded identities after legacy data already existed.
// Preserve their complete history without changing stored timestamps.
export const ACCOUNT_JOINED_AT = `COALESCE((SELECT CASE WHEN user_id IN (
  '07588797-a471-44d1-99ce-7fb4f188c196', 'bedcf897-a6f0-4730-b757-402b14891ca5', '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed'
) THEN 0 ELSE created_at END FROM accounts WHERE user_id = ?), 9223372036854775807)`;
