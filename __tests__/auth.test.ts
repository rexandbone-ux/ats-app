import {
  can,
  canEdit,
  canManageUsers,
  ROLE_LABELS,
  SECTIONS,
  Role,
  Section,
} from "@/lib/auth";

const ALL_ROLES: Role[] = [
  "super_admin",
  "admin",
  "recruiter",
  "hiring_manager",
  "client_user",
  "candidate_user",
];

describe("can", () => {
  it("returns false when role is undefined", () => {
    expect(can(undefined, "dash")).toBe(false);
  });

  it("grants super_admin access to every section", () => {
    for (const section of SECTIONS) {
      expect(can("super_admin", section)).toBe(true);
    }
  });

  it("does not grant admin the sourcing section", () => {
    expect(can("admin", "sourcing")).toBe(false);
    expect(can("admin", "settings")).toBe(true);
  });

  it("does not grant recruiter the settings section but allows sourcing", () => {
    expect(can("recruiter", "settings")).toBe(false);
    expect(can("recruiter", "sourcing")).toBe(true);
  });

  it("restricts hiring_manager to its allowed sections", () => {
    const allowed: Section[] = ["dash", "cands", "pipeline", "jobs", "interviews", "reports"];
    for (const section of allowed) {
      expect(can("hiring_manager", section)).toBe(true);
    }
    expect(can("hiring_manager", "clients")).toBe(false);
    expect(can("hiring_manager", "settings")).toBe(false);
  });

  it("restricts client_user to dash, jobs and cands", () => {
    expect(can("client_user", "dash")).toBe(true);
    expect(can("client_user", "jobs")).toBe(true);
    expect(can("client_user", "cands")).toBe(true);
    expect(can("client_user", "pipeline")).toBe(false);
  });

  it("restricts candidate_user to only the dashboard", () => {
    expect(can("candidate_user", "dash")).toBe(true);
    for (const section of SECTIONS.filter((s) => s !== "dash")) {
      expect(can("candidate_user", section)).toBe(false);
    }
  });

  it("gives every role access to the dashboard", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "dash")).toBe(true);
    }
  });
});

describe("canEdit", () => {
  it("is true for super_admin, admin and recruiter", () => {
    expect(canEdit("super_admin")).toBe(true);
    expect(canEdit("admin")).toBe(true);
    expect(canEdit("recruiter")).toBe(true);
  });

  it("is false for non-editing roles and undefined", () => {
    expect(canEdit("hiring_manager")).toBe(false);
    expect(canEdit("client_user")).toBe(false);
    expect(canEdit("candidate_user")).toBe(false);
    expect(canEdit(undefined)).toBe(false);
  });
});

describe("canManageUsers", () => {
  it("is true only for super_admin and admin", () => {
    expect(canManageUsers("super_admin")).toBe(true);
    expect(canManageUsers("admin")).toBe(true);
  });

  it("is false for all other roles and undefined", () => {
    expect(canManageUsers("recruiter")).toBe(false);
    expect(canManageUsers("hiring_manager")).toBe(false);
    expect(canManageUsers("client_user")).toBe(false);
    expect(canManageUsers("candidate_user")).toBe(false);
    expect(canManageUsers(undefined)).toBe(false);
  });
});

describe("ROLE_LABELS", () => {
  it("has a human-readable label for every role", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(typeof ROLE_LABELS[role]).toBe("string");
    }
  });

  it("maps known roles to expected labels", () => {
    expect(ROLE_LABELS.super_admin).toBe("Super Admin");
    expect(ROLE_LABELS.client_user).toBe("Client");
    expect(ROLE_LABELS.candidate_user).toBe("Candidate");
  });
});
