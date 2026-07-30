import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";

describe("supabase client", () => {
  it("exposes a configured url and anon key", () => {
    expect(typeof SUPABASE_URL).toBe("string");
    expect(SUPABASE_URL).toMatch(/^https:\/\//);
    expect(typeof SUPABASE_ANON_KEY).toBe("string");
    expect(SUPABASE_ANON_KEY.length).toBeGreaterThan(0);
  });

  it("creates a client with auth and query helpers", () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe("function");
    expect(supabase.auth).toBeDefined();
    expect(typeof supabase.auth.signInWithPassword).toBe("function");
  });
});
