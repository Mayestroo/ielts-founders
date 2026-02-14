const BLOCKED_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
];

const URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

const stripDangerousProtocols = (value: string) => {
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  if (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:text/html')
  ) {
    return '';
  }

  return value;
};

const sanitizeWithDomParser = (html: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  for (const tag of BLOCKED_TAGS) {
    doc.querySelectorAll(tag).forEach((element) => element.remove());
  }

  doc.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }

      if (URL_ATTRS.has(name)) {
        const safeValue = stripDangerousProtocols(attr.value);
        if (!safeValue) {
          element.removeAttribute(attr.name);
        } else if (safeValue !== attr.value) {
          element.setAttribute(attr.name, safeValue);
        }
      }
    });
  });

  return doc.body.innerHTML;
};

const sanitizeWithRegex = (html: string): string => {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
};

export const sanitizeHtml = (html: string): string => {
  if (!html) {
    return '';
  }

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return sanitizeWithRegex(html);
  }

  return sanitizeWithDomParser(html);
};
