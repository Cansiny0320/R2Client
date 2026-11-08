import { Copy, Download, Link2, LockKeyhole, QrCode, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatLink, nameOf } from "@r2client/core";
import type { Item, Profile } from "@r2client/core";
import { Modal } from "./common";
import type { Platform, Preferences, Tr } from "./common";
interface Managed {
  id: string;
  link: string;
  name: string;
  expires: string;
}
function endpoint(base: string, pathname: string) {
  const u = new URL(base);
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw new Error("Share service must use HTTPS");
  if (u.username || u.password)
    throw new Error("Do not place credentials in the share service URL");
  return new URL(pathname, u.origin).href;
}
export async function copyText(p: Platform, value: string) {
  if (p.copyText) await p.copyText(value);
  else await navigator.clipboard.writeText(value);
}
export function ShareDialog({
  platform,
  profile,
  item,
  prefs,
  t,
  close,
  notify,
}: {
  platform: Platform;
  profile: Profile;
  item: Item;
  prefs: Preferences;
  t: Tr;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [kind, setKind] = useState<"signed" | "public" | "password">(
    profile.publicBase ? "public" : "signed",
  );
  const [seconds, setSeconds] = useState(3600),
    [format, setFormat] = useState(prefs.shareFormat),
    [link, setLink] = useState(""),
    [qr, setQr] = useState("");
  const [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [managed, setManaged] = useState<Managed[]>([]);
  const key = "r2client-share-history";
  useEffect(() => {
    try {
      setManaged(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      /* fresh state */
    }
  }, []);
  useEffect(() => {
    let active = true;
    if (!link) setQr("");
    else
      void QRCode.toDataURL(link, { width: 176, margin: 1 })
        .then((v) => {
          if (active) setQr(v);
        })
        .catch(() => {
          if (active) setQr("");
        });
    return () => {
      active = false;
    };
  }, [link]);
  const persist = (values: Managed[]) => {
    setManaged(values);
    localStorage.setItem(key, JSON.stringify(values));
  };
  async function generate() {
    setBusy(true);
    setError("");
    setLink("");
    try {
      if (kind !== "password") {
        setLink(await platform.api.links(profile.id, item.key, seconds, kind));
        return;
      }
      const upstream = await platform.api.links(profile.id, item.key, seconds, "signed");
      const url = endpoint(prefs.shareServer, "/api/shares");
      const response = await fetch(url, {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ url: upstream, name: nameOf(item.key), password, seconds }),
      });
      if (!response.ok)
        throw new Error("Share service rejected the request (" + response.status + ")");
      const share = (await response.json()) as Managed;
      setLink(share.link);
      persist([share, ...managed].slice(0, 100));
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(row: Managed) {
    setError("");
    try {
      const response = await fetch(
        endpoint(prefs.shareServer, "/api/shares/" + encodeURIComponent(row.id)),
        { method: "DELETE", credentials: "omit", headers: { authorization: "Bearer " + token } },
      );
      if (!response.ok) throw new Error("Could not revoke this link (" + response.status + ")");
      persist(managed.filter((x) => x.id !== row.id));
      if (row.link === link) setLink("");
      notify(t("Link revoked", "已撤销链接"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Modal title={t("Share file", "分享文件", "ファイルを共有", "파일 공유")} open onClose={close}>
      <div className="dialog-body stack">
        <div className="subtle truncate">{nameOf(item.key)}</div>
        <label>
          {t("Link type", "链接类型")}
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setLink("");
            }}
          >
            <option value="signed">{t("Private · time limited", "私有 · 限时链接")}</option>
            <option value="public" disabled={!profile.publicBase}>
              {t("Public URL", "公开链接")}
            </option>
            <option value="password" disabled={!prefs.shareServer || profile.demo}>
              {t("Password protected", "密码保护")}
            </option>
          </select>
        </label>
        {kind !== "public" && (
          <label>
            {t("Expires after", "有效期")}
            <select
              value={seconds}
              onChange={(e) => {
                setSeconds(+e.target.value);
                setLink("");
              }}
            >
              <option value={900}>{t("15 minutes", "15 分钟")}</option>
              <option value={3600}>{t("1 hour", "1 小时")}</option>
              <option value={86400}>{t("1 day", "1 天")}</option>
              <option value={604800}>{t("7 days", "7 天")}</option>
            </select>
          </label>
        )}
        {kind === "password" && (
          <>
            <label>
              {t("Share password", "分享密码")}
              <input
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              {t("Share service admin token", "分享服务管理令牌")}
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="row gap">
          <button
            className="button primary"
            disabled={busy || (kind === "password" && (!token || password.length < 8))}
            onClick={() => void generate()}
          >
            {kind === "password" ? <LockKeyhole size={15} /> : <Link2 size={15} />}{" "}
            {busy ? t("Generating…", "生成中…") : t("Generate link", "生成链接")}
          </button>
        </div>
        {link && (
          <>
            <div className="share-preview">
              {qr ? (
                <img src={qr} alt={t("QR code", "二维码")} width={142} height={142} />
              ) : (
                <QrCode size={36} />
              )}
            </div>
            <div className="row gap">
              <select
                aria-label={t("Link format", "链接格式")}
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                <option value="url">URL</option>
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
                <option value="bbcode">BBCode</option>
              </select>
              <button
                className="button"
                onClick={() =>
                  void copyText(platform, formatLink(link, nameOf(item.key), format))
                    .then(() => notify(t("Link copied", "链接已复制")))
                    .catch((e) => setError(String(e)))
                }
              >
                <Copy size={15} /> {t("Copy", "复制")}
              </button>
              {qr && (
                <a className="button" download="r2client-qr.png" href={qr}>
                  <Download size={15} /> QR
                </a>
              )}
            </div>
            <input aria-label={t("Share URL", "分享链接")} readOnly value={link} />
          </>
        )}
        {kind === "password" && managed.length > 0 && (
          <div className="stack">
            {managed
              .filter((m) => new Date(m.expires) > new Date())
              .map((m) => (
                <div className="row between" key={m.id}>
                  <span className="truncate">{m.name}</span>
                  <button
                    className="button danger-text"
                    disabled={!token}
                    onClick={() => void revoke(m)}
                  >
                    <Trash2 size={14} /> {t("Revoke", "撤销")}
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
