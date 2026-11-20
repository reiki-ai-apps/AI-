// 依存ゼロの最小ZIP読み取り。素材ZIP (§30 I0「PublicationPackage JSON＋素材ZIPを検証取込」) に使う。
//
// 対応するのは「無圧縮(0)」と「deflate(8)」だけ。deflateはブラウザ/Node標準の
// DecompressionStream('deflate-raw') に任せるので、外部ライブラリは要らない。

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
    this.code = 'ZIP_READ_FAILED';
  }
}

function findEocd(view) {
  // コメント長は最大65535。末尾から遡って署名を探す。
  const min = Math.max(0, view.byteLength - 65_557);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new ZipError('ZIPファイルとして読み取れません（末尾レコードが見つかりません）。');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('この環境では圧縮されたZIPを展開できません。無圧縮のZIPを使ってください。');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * ZIPの中身を { パス → バイト列 } で返す。ディレクトリ項目は除く。
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder('utf-8');
  const out = new Map();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) {
      throw new ZipError('ZIPの中央ディレクトリが壊れています。');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;

    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipError(`ZIPのローカルヘッダーが壊れています: ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      out.set(name, raw.slice());
    } else if (method === 8) {
      out.set(name, await inflateRaw(raw));
    } else {
      throw new ZipError(`対応していない圧縮方式です（${method}）: ${name}`);
    }
  }

  return out;
}
