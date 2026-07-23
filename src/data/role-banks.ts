import rawData from "./role-banks.json";

// Pre-seeded role templates. The fixed role chips are a known list, so their
// topics + full MCQ bank are generated ONCE (npm run seed:roles) into
// role-banks.json. startSession clones a match straight from disk with zero AI,
// making Begin instant. Unknown / custom ("Other") roles return null here and
// fall back to the live blueprint + bank build.

export interface RoleBankTopic {
  name: string;
  importance: number; // this topic's share of the 1000-point total (normalized in startSession)
  startLevel: number; // starting level guess 1..10
}

export interface RoleBankMcq {
  topicName: string;
  level: number;
  stem: string;
  options: string[];
  correctIndex: number;
}

export interface RoleBank {
  role: string;
  language: string;
  topics: RoleBankTopic[];
  bank: RoleBankMcq[];
}

interface RoleBanksFile {
  version: number;
  generatedRoles: number;
  roles: RoleBank[];
}

const data = rawData as unknown as RoleBanksFile;

const norm = (s: string) => s.trim().toLowerCase();

export function getRoleBank(role: string, language: string): RoleBank | null {
  return (
    data.roles.find((r) => norm(r.role) === norm(role) && r.language === language) ?? null
  );
}
