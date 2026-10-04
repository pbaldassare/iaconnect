/** The fields of an Auth user that decide whether an email identifies its owner. */
export interface AuthUserLike {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

/**
 * The user who owns `email`, among `users`: same address AND confirmed. Auth is shared with
 * another application where anyone can sign up with any address: an unconfirmed account
 * proves nothing about who its owner is, and must never receive a role by email.
 * Pure: unit tested.
 */
export function confirmedUserByEmail(users: readonly AuthUserLike[], email: string): AuthUserLike | null {
  const wanted = email.trim().toLowerCase();
  return (
    users.find((user) => user.email?.toLowerCase() === wanted && Boolean(user.email_confirmed_at)) ?? null
  );
}
