// DOM構築ヘルパー。textContentのみを使い、innerHTMLは一切使わない。
//
// 重要: ネイティブの append(null) は文字列 "null" を描画してしまう。
// 条件付きの子要素は必ずこの el() 経由で渡すこと (null / undefined / false は捨てられる)。

/**
 * @param {string} tag
 * @param {object|string|null} [props] 属性。文字列を渡した場合は className として扱う。
 * @param {...(Node|string|number|null|undefined|false|Array)} children
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);

  if (typeof props === 'string') {
    node.className = props;
  } else if (props && typeof props === 'object' && !(props instanceof Node)) {
    applyProps(node, props);
  } else if (props != null && props !== false) {
    children.unshift(props);
  }

  append(node, children);
  return node;
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv != null) node.dataset[dk] = String(dv);
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [sk, sv] of Object.entries(value)) {
        if (sv != null) node.style.setProperty(sk, String(sv));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

/** 子要素の追加。null / undefined / false / 空配列は黙って無視する。 */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false || child === '') continue;
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
  return parent;
}

/** 子要素をすべて外す。innerHTML = '' の代わり。 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 子要素を差し替える。 */
export function replace(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/** ボタン。type既定はbutton (フォーム内での意図しない送信を防ぐ)。 */
export function button(label, props = {}) {
  return el('button', { type: 'button', ...props }, label);
}

/** 画面には出さないが読み上げには載せるテキスト (§32)。 */
export function srOnly(text) {
  return el('span', { class: 'sr-only' }, text);
}

/** ラベル付きフィールド。id紐付けとrequired表示をまとめる。 */
export function field(labelText, control, { hint = null, required = false } = {}) {
  if (!control.id) control.id = `f-${Math.random().toString(36).slice(2, 10)}`;
  return el(
    'div',
    { class: 'field' },
    el(
      'label',
      { class: 'field-label', for: control.id },
      labelText,
      required ? el('span', { class: 'field-required' }, '必須') : null,
    ),
    control,
    hint ? el('p', { class: 'field-hint' }, hint) : null,
  );
}

/** 状態を表す色つきラベル。色だけで伝えないよう、必ず日本語文言を伴う (§32)。 */
export function statusTag(text, tone) {
  return el('span', { class: `tag tone-${tone}` }, text);
}

/** キー操作のバインド。{'ArrowLeft': fn} の形で渡す。 */
export function onKeys(node, map) {
  node.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const handler = map[event.key];
    if (!handler) return;
    event.preventDefault();
    handler(event);
  });
  return node;
}

/** フォーカスを移す。要素が無ければ何もしない。 */
export function focus(node) {
  if (node && typeof node.focus === 'function') node.focus();
}
