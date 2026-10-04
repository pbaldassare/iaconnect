/**
 * Where the confirmation mail of a new account lands (`/auth/callback?next=/benvenuto`).
 * Same behaviour as /area-riservata: the first visit files the access request saved at
 * sign-up and opens /in-attesa.
 */
export { GET } from "../area-riservata/route";
