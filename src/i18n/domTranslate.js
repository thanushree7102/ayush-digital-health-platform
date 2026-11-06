// Translates every English text on the screen that has an entry in the dictionary, even text that was
// written without t(). Works on text and on placeholder / title / alt / aria-label. Switching back to
// English restores the original text. Text typed by people (input values) is never touched.
import { DICT } from './dict';

const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

let lang = 'en';
let obs = null;
const textRec = new WeakMap(); // text node -> { en, out }  (what React wrote, and what we put there)
const attrRec = new WeakMap(); // element -> { attr: { en, out } }

const lookup = (en) => {
  const d = DICT[lang];
  return d ? d[norm(en)] : undefined;
};
const skipped = (el) => !el || SKIP.has(el.tagName) || (el.closest && el.closest('[translate="no"],[data-notranslate]'));

function doText(n) {
  const el = n.parentElement;
  if (skipped(el)) return;
  const rec = textRec.get(n);
  const en = rec && n.nodeValue === rec.out ? rec.en : n.nodeValue; // if React changed it, the new value is the new English
  const tx = lang === 'en' ? undefined : lookup(en);
  if (!tx) {
    if (rec && n.nodeValue === rec.out) n.nodeValue = rec.en;
    textRec.delete(n);
    return;
  }
  const lead = en.match(/^\s*/)[0];
  const trail = en.match(/\s*$/)[0];
  const out = lead + tx + trail;
  if (n.nodeValue !== out) n.nodeValue = out;
  textRec.set(n, { en, out });
}

function doAttrs(el) {
  if (skipped(el)) return;
  let recs = attrRec.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a);
    const rec = recs && recs[a];
    const en = rec && cur === rec.out ? rec.en : cur;
    const tx = lang === 'en' ? undefined : lookup(en);
    if (!tx) {
      if (rec && cur === rec.out) el.setAttribute(a, rec.en);
      if (recs) delete recs[a];
      continue;
    }
    if (cur !== tx) el.setAttribute(a, tx);
    if (!recs) { recs = {}; attrRec.set(el, recs); }
    recs[a] = { en, out: tx };
  }
}

function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return undefined;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n = w.nextNode();
  while (n) { if (n.nodeType === 3) doText(n); else doAttrs(n); n = w.nextNode(); }
  return undefined;
}

export function applyDomLang(l) {
  lang = l;
  if (typeof document === 'undefined') return;
  if (!obs) {
    obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach((x) => walk(x));
        else if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  walk(document.body);
}
