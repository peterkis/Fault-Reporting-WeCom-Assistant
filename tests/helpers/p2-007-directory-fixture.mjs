// Synthetic capacity data only; never copies an upstream directory response.
export function syntheticDirectoryTree({ departments = 333, members = 4_290,
  additionalMemberships = 0, fullFields = true } = {}) {
  const nodes = Array.from({ length: departments }, (_, index) => ({
    id: `d${String(index).padStart(5, '0')}`, name: `Synthetic department ${index}`,
    gid: index + 1, users: [], children: [],
  }));
  for (let index = 1; index < nodes.length; index++) {
    nodes[Math.floor((index - 1) / 5)].children.push(nodes[index]);
  }
  const users = Array.from({ length: members }, (_, index) => ({
    user_id: `u${String(index).padStart(5, '0')}`,
    tuishiben_id: `e${String(index).padStart(5, '0')}`,
    ...(fullFields ? { nickname: `Synthetic user ${index}`, phone: `test-phone-${index}`,
      wecom_id: `w${String(index).padStart(5, '0')}` } : {}),
  }));
  users.forEach((user, index) => nodes[index % departments].users.push({ ...user }));
  for (let index = 0; index < additionalMemberships; index++) {
    nodes[(index % departments + 1) % departments].users.push({ ...users[index % members] });
  }
  return [nodes[0]];
}
