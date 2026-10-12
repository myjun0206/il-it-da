export type LatteTemperature = "ICE" | "HOT";
export type LatteTarget = { name: string; temperature: LatteTemperature | null };
const LATTE_LABEL = /(?:(?:ICED?|HOT|아이스|차가운|따뜻한|따듯한|뜨거운|핫)[ \t]+)?[가-힣A-Za-z]+(?:[ \t]+카페)?[ \t]*라떼/giu;

const PREFIXES: readonly [string, LatteTemperature | null][] = [
  ["iced", "ICE"], ["ice", "ICE"], ["아이스", "ICE"], ["차가운", "ICE"],
  ["따뜻한", "HOT"], ["따듯한", "HOT"], ["뜨거운", "HOT"], ["핫", "HOT"], ["hot", "HOT"],
  ["일반", null], ["기본", null],
];

export function parseLatteTarget(value: string): LatteTarget | null {
  const compact = value.normalize("NFC").replace(/\s+/gu, "").toLowerCase();
  let name = compact;
  let temperature: LatteTemperature | null = null;
  for (const [prefix, mode] of PREFIXES) {
    if (!compact.startsWith(prefix)) continue;
    name = compact.slice(prefix.length);
    temperature = mode;
    break;
  }
  if (name !== "라떼" && !/^[a-z가-힣]+라떼$/u.test(name)) return null;
  return { name, temperature };
}

export function sameLatteTarget(left: string, right: string): boolean {
  const leftTarget = parseLatteTarget(left);
  const rightTarget = parseLatteTarget(right);
  return Boolean(leftTarget && rightTarget && sameLatteIdentity(leftTarget, rightTarget));
}

function sameLatteIdentity(left: LatteTarget, right: LatteTarget): boolean {
  return left.name !== "라떼" && left.name === right.name
    && (!left.temperature || !right.temperature || left.temperature === right.temperature);
}

export function extractLatteTargets(text: string): LatteTarget[] {
  return [...text.matchAll(LATTE_LABEL)].flatMap(match => {
    const target = parseLatteTarget(match[0]);
    return target ? [target] : [];
  });
}

export function sameLatteEntityTarget(left: string, right: string): boolean {
  const leftTargets = extractLatteTargets(left);
  const rightTargets = extractLatteTargets(right);
  return leftTargets.length === 1 && rightTargets.length === 1 && sameLatteIdentity(leftTargets[0], rightTargets[0]);
}