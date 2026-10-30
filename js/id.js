// 항목 고유값. crypto.randomUUID는 https가 아닌 주소(같은 와이파이의 휴대폰으로 접속 등)에서 없을 수 있어서 쓰지 않는다.

export function createId(prefix) {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
