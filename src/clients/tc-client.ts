const TC_BASE = "https://www.transparentclassroom.com/api/v1";

export interface TCChild {
  id: number;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  sex: string | null;
  dominant_language: string | null;
  classroom_ids: number[];
  program: string | null;
  ethnicity: string[];
  household_income: string | null;
  grade: string | null;
  student_id: string | null;
}

export interface TCClassroom {
  id: number;
  name: string;
  lesson_set_id: number;
  age_range: string | null;
}

export interface TCLesson {
  id: number;
  child_id: number;
  classroom_id: number;
  lesson_id: number;
  date: string;
  status: string;
  comments: string | null;
}

export interface TCObservation {
  id: number;
  child_id: number;
  classroom_id: number;
  author_id: number;
  date: string;
  observation: string;
}

export interface TCEvent {
  id: number;
  name: string;
  start_at: string;
  stop_at: string;
  description: string | null;
  classroom_ids: number[];
}

export interface TCUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  roles: string[];
  school_ids: number[];
}

export interface TCActivity {
  id: number;
  type: string;
  created_at: string;
  details: Record<string, unknown>;
}

export class TCClient {
  private email: string;
  private password: string;
  private apiToken: string | null = null;
  private schoolId: number | null = null;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
  }

  static fromToken(apiToken: string, schoolId: number): TCClient {
    const client = new TCClient("", "");
    client.apiToken = apiToken;
    client.schoolId = schoolId;
    return client;
  }

  getApiToken(): string {
    if (!this.apiToken) throw new Error("Not authenticated");
    return this.apiToken;
  }

  async authenticate(): Promise<{ api_token: string; id: number; first_name: string; last_name: string; roles: string[]; school_id: number }> {
    const basicAuth = "Basic " + Buffer.from(`${this.email}:${this.password}`).toString("base64");
    const res = await fetch(`${TC_BASE}/authenticate.json`, {
      method: "GET",
      headers: { Authorization: basicAuth },
    });
    if (!res.ok) {
      throw new Error(`TC authentication failed ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as { api_token: string; id: number; first_name: string; last_name: string; roles: string[]; school_id: number };
    this.apiToken = data.api_token;
    // Auto-set the school from the auth response so parents don't need to call setSchoolId.
    if (data.school_id && !this.schoolId) {
      this.schoolId = data.school_id;
    }
    return data;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.apiToken) await this.authenticate();
  }

  private async request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    await this.ensureAuth();
    const url = new URL(`${TC_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      headers: {
        "X-TransparentClassroomToken": this.apiToken!,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`TC API error ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async getSchools(): Promise<Array<{ id: number; name: string }>> {
    try {
      return await this.request("/schools.json");
    } catch {
      // Parent accounts cannot list all schools; return the school from authenticate instead.
      if (this.schoolId) {
        return [{ id: this.schoolId, name: `School ${this.schoolId}` }];
      }
      throw new Error("Could not retrieve schools. Ensure you are authenticated.");
    }
  }

  async setSchoolId(id: number) {
    this.schoolId = id;
  }

  private schoolParam(): Record<string, number> {
    if (!this.schoolId) throw new Error("No school selected. Call setSchoolId first.");
    return { school_id: this.schoolId };
  }

  async getChildren(): Promise<TCChild[]> {
    await this.ensureAuth();
    return this.request("/children.json", this.schoolParam());
  }

  async getClassrooms(): Promise<TCClassroom[]> {
    await this.ensureAuth();
    return this.request("/classrooms.json", this.schoolParam());
  }

  async getLessons(childId: number, params: { date_start?: string; date_end?: string } = {}): Promise<TCLesson[]> {
    await this.ensureAuth();
    return this.request("/lessons.json", {
      ...this.schoolParam(),
      child_id: childId,
      ...params,
    });
  }

  async getObservations(childId: number, params: { date_start?: string; date_end?: string } = {}): Promise<TCObservation[]> {
    await this.ensureAuth();
    return this.request("/observations.json", {
      ...this.schoolParam(),
      child_id: childId,
      ...params,
    });
  }

  async getEvents(params: { start_date?: string; end_date?: string } = {}): Promise<TCEvent[]> {
    await this.ensureAuth();
    return this.request("/events.json", { ...this.schoolParam(), ...params });
  }

  async getUsers(): Promise<TCUser[]> {
    await this.ensureAuth();
    return this.request("/users.json", this.schoolParam());
  }

  async getActivity(params: { date_start?: string; date_end?: string } = {}): Promise<TCActivity[]> {
    await this.ensureAuth();
    return this.request("/activity.json", { ...this.schoolParam(), ...params });
  }

  async getForms(): Promise<unknown[]> {
    await this.ensureAuth();
    return this.request("/forms.json", this.schoolParam());
  }

  async getConferenceReports(childId: number): Promise<unknown[]> {
    await this.ensureAuth();
    return this.request("/conference_reports.json", {
      ...this.schoolParam(),
      child_id: childId,
    });
  }
}
