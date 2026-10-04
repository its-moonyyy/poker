// Compliance v1: allow all (play money). Real-money TODOs: jurisdiction
// matrix, KYC/AML status, geofence (ip/geo), self-exclusion, audit log.
export class AllowAllCompliance {
  async canPlay(_userId: string, _ip: string): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }
}
