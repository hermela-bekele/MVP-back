/**
 * Integration boundary for the Ministry's EMIS (Education Management Information
 * System) authoritative school registry. No live EMIS API access, credentials, or
 * documentation exist yet, so this file defines the contract a future real
 * implementation must fulfill — it does not call out to anything, and nothing in
 * this codebase should invent endpoint URLs or fabricate EMIS data.
 *
 * Until real access exists, MOE connects schools manually via `POST
 * /api/schools/connect` (see routes/api.ts), optionally recording an EMIS
 * reference ID on the school (`schools.emis_id`) so it can be matched and
 * reconciled once the sync described here goes live. `schools.registry_source`
 * ('manual' | 'emis') records which path created each row.
 *
 * Expected reconciliation flow once EMIS access is granted:
 *   EMIS authoritative registry -> searchAuthoritativeRegistry() -> MOE reviews
 *   candidates -> match against existing PRIME schools by emis_id (stable
 *   identifier, never by name/region alone, to avoid duplicate schools) ->
 *   activate via the same connect/activate path used today.
 */

export interface EmisRegistryCandidate {
  emisId: string;
  name: string;
  region: string;
  woreda?: string;
  type?: 'Public' | 'Private';
}

export interface EmisRegistryClient {
  /** Search the Ministry's authoritative school registry by name/region. */
  searchAuthoritativeRegistry(query: string): Promise<EmisRegistryCandidate[]>;
  /** Fetch one institution's authoritative record by its stable EMIS ID. */
  getByEmisId(emisId: string): Promise<EmisRegistryCandidate | null>;
}

/**
 * No EMIS credentials/API access exist. Any call here is a configuration error,
 * not a network failure — callers must check availability first rather than
 * silently falling back to fabricated results.
 */
export const emisRegistryUnavailable: EmisRegistryClient = {
  async searchAuthoritativeRegistry() {
    throw new Error(
      'EMIS registry integration is not configured. Use the manual Connect/Activate flow ' +
        '(POST /schools/connect) until Ministry EMIS API access and credentials are available.'
    );
  },
  async getByEmisId() {
    throw new Error('EMIS registry integration is not configured.');
  },
};

export function isEmisRegistryConfigured(): boolean {
  return false;
}
