const USER_MENTION_RE = /<@!?(\d{17,20})>/g;
const ROLE_MENTION_RE = /<@&(\d{17,20})>/g;

function collectMentionIdsFromText(text) {
  const users = new Set();
  const roles = new Set();
  if (!text || typeof text !== 'string') return { users, roles };

  for (const match of text.matchAll(USER_MENTION_RE)) users.add(match[1]);
  for (const match of text.matchAll(ROLE_MENTION_RE)) roles.add(match[1]);
  return { users, roles };
}

function embedTextParts(embed) {
  const data = embed?.data ?? embed?.toJSON?.() ?? embed;
  if (!data || typeof data !== 'object') return '';
  const chunks = [data.title, data.description, data.footer?.text, data.author?.name];
  for (const field of data.fields ?? []) {
    chunks.push(field.name, field.value);
  }
  return chunks.filter(Boolean).join('\n');
}

function buildAllowedMentions(users, roles, existing, { pingUsers, pingRoles, content }) {
  const userIds = [...users];
  const roleIds = [...roles];
  const parse = new Set(existing.parse ?? []);
  const contentStr = typeof content === 'string' ? content : '';

  if (contentStr.includes('@everyone')) parse.add('everyone');
  if (pingUsers) parse.add('users');
  if (pingRoles) parse.add('roles');

  const result = {
    ...existing,
    users: [...new Set([...(existing.users ?? []), ...userIds])],
    roles: [...new Set([...(existing.roles ?? []), ...roleIds])],
  };

  if (parse.size > 0) {
    result.parse = [...parse];
  } else if (userIds.length || roleIds.length) {
    result.parse = [];
  }

  return result;
}

/**
 * Užtikrina, kad vartotojo / rolės mention embeduose ir turinyje
 * būtų rodomi kaip @vardas, o ne žalias `<@id>` tekstas.
 */
function withAllowedMentions(options, { pingUsers = false, pingRoles = false } = {}) {
  if (options == null) return options;

  if (typeof options === 'string') {
    const from = collectMentionIdsFromText(options);
    if (!from.users.size && !from.roles.size) return options;
    return {
      content: options,
      allowedMentions: buildAllowedMentions(from.users, from.roles, {}, {
        pingUsers,
        pingRoles,
        content: options,
      }),
    };
  }

  if (typeof options !== 'object') return options;

  const existing = options.allowedMentions ?? {};
  const users = new Set(existing.users ?? []);
  const roles = new Set(existing.roles ?? []);

  if (options.content) {
    const from = collectMentionIdsFromText(options.content);
    from.users.forEach(id => users.add(id));
    from.roles.forEach(id => roles.add(id));
  }

  for (const embed of options.embeds ?? []) {
    const from = collectMentionIdsFromText(embedTextParts(embed));
    from.users.forEach(id => users.add(id));
    from.roles.forEach(id => roles.add(id));
  }

  if (users.size === 0 && roles.size === 0) return options;

  return {
    ...options,
    allowedMentions: buildAllowedMentions(users, roles, existing, {
      pingUsers,
      pingRoles,
      content: options.content,
    }),
  };
}

module.exports = { withAllowedMentions, collectMentionIdsFromText };
