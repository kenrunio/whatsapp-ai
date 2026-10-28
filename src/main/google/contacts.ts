// Google Contacts, read-only: the user's contacts and "other contacts" (people they've e-mailed).

import { googleGet } from "./auth";

const API = "https://people.googleapis.com/v1";

interface Person {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string; type?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string; type?: string }[];
  organizations?: { name?: string; title?: string }[];
  addresses?: { formattedValue?: string; type?: string }[];
}

export interface ContactHit {
  name: string;
  phones: string[];
  emails: string[];
  company?: string;
  title?: string;
  addresses?: string[];
  source: "contacts" | "other contacts";
}

let warmed = false;

function hit(p: Person, source: ContactHit["source"]): ContactHit {
  return {
    name: p.names?.[0]?.displayName ?? "",
    phones: (p.phoneNumbers ?? []).map((x) => (x.type ? `${x.value} (${x.type})` : (x.value ?? ""))).filter(Boolean),
    emails: (p.emailAddresses ?? []).map((x) => x.value ?? "").filter(Boolean),
    company: p.organizations?.[0]?.name,
    title: p.organizations?.[0]?.title,
    addresses: p.addresses?.map((a) => a.formattedValue ?? "").filter(Boolean),
    source,
  };
}

export async function searchContacts(query: string): Promise<ContactHit[]> {
  const q = query.trim();
  if (!q) return [];
  const mask = "names,emailAddresses,phoneNumbers,organizations,addresses";
  // the search cache needs one empty query first (Google's documented warm-up)
  if (!warmed) {
    await googleGet(`${API}/people:searchContacts?query=&readMask=names`).catch(() => undefined);
    warmed = true;
  }
  const [mine, other] = await Promise.all([
    googleGet<{ results?: { person: Person }[] }>(`${API}/people:searchContacts?${new URLSearchParams({ query: q, readMask: mask, pageSize: "10" })}`),
    googleGet<{ results?: { person: Person }[] }>(
      `${API}/otherContacts:search?${new URLSearchParams({ query: q, readMask: "names,emailAddresses,phoneNumbers", pageSize: "10" })}`,
    ).catch(() => ({ results: [] })),
  ]);
  return [...(mine.results ?? []).map((r) => hit(r.person, "contacts")), ...(other.results ?? []).map((r) => hit(r.person, "other contacts"))].slice(0, 12);
}
