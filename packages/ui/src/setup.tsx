import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Cloud,
  Database,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  KeyRound,
  Settings,
  Upload,
} from "lucide-react";
import { useState } from "react";
import type { Connection, SavedAccount } from "@r2client/core";
import { connectionFailure, Modal } from "./common";
import type { Platform, Tr } from "./common";

export function Welcome({ t, start }: { t: Tr; start: () => void }) {
  const features = [
    [Upload, t("Fast transfers", "高效传输"), t("Quick uploads and downloads", "快速上传下载")],
    [HardDrive, t("Secure storage", "安全存储"), t("Keep your data secure", "数据安全可靠")],
    [Database, t("Simple management", "简单管理"), t("An intuitive interface", "直观的界面")],
  ] as const;
  return (
    <div className="setup-welcome">
      <span className="setup-symbol">
        <Cloud size={36} />
      </span>
      <h1>{t("Welcome to R2 Desktop", "欢迎使用 R2 Desktop")}</h1>
      <p>
        {t(
          "Manage your Cloudflare R2 object storage",
          "开始你的云存储之旅，轻松管理 Cloudflare R2 对象存储",
        )}
      </p>
      <div className="setup-features">
        {features.map(([Icon, title, description]) => (
          <div key={title}>
            <span>
              <Icon size={18} />
            </span>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
        ))}
      </div>
      <button className="button primary" onClick={start}>
        {t("Create your first bucket", "创建第一个存储桶")}
      </button>
      <small>{t("Get started in a few steps", "只需几步配置，即可开始使用")}</small>
    </div>
  );
}

export function BucketSetup({
  p,
  t,
  accounts,
  linkedAccounts,
  forgetAccount,
  close,
  saved,
}: {
  p: Platform;
  t: Tr;
  accounts: SavedAccount[];
  linkedAccounts: string[];
  forgetAccount: (id: string) => Promise<void>;
  close: () => Promise<void>;
  saved: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [account, setAccount] = useState("");
  const [reuse, setReuse] = useState<SavedAccount>();
  const [forget, setForget] = useState<SavedAccount>();
  const [forgetError, setForgetError] = useState("");
  const [access, setAccess] = useState("");
  const [secret, setSecret] = useState("");
  const [showAccess, setShowAccess] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [session, setSession] = useState("");
  const [remember, setRemember] = useState(true);
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState<Connection["jurisdiction"]>("default");
  const [publicAccess, setPublicAccess] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sync, setSync] = useState<"running" | "done" | "failed">("running");
  const [error, setError] = useState<ReturnType<typeof connectionFailure>>();
  const steps = [
    [
      Cloud,
      t("Account information", "账户信息"),
      t("Enter your Cloudflare Account ID", "输入您的 Cloudflare 账户 ID"),
    ],
    [
      KeyRound,
      t("API credentials", "API 凭证"),
      t("Enter your R2 API access keys", "输入您的 R2 API 访问密钥"),
    ],
    [
      Database,
      t("Bucket configuration", "存储桶配置"),
      t("Configure your bucket", "配置您的存储桶"),
    ],
    [Globe, t("Public access", "公开访问"), t("Configure public access", "配置公开访问设置")],
    [
      Settings,
      t("Finish setup", "完成设置"),
      t("Review the bucket configuration before saving", "在保存前审查您的存储桶配置"),
    ],
  ] as const;
  const [Icon, title, detail] = steps[step]!;
  const masked = (value: string) =>
    value.length > 12 ? value.slice(0, 8) + " … " + value.slice(-4) : "••••";
  const remembered = !!reuse && reuse.accountId === account.trim() && !access && !secret;
  const validUrl = (() => {
    try {
      const u = new URL(publicUrl);
      return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
    } catch {
      return false;
    }
  })();
  const valid = [
    /^[a-f0-9]{32}$/i.test(account.trim()),
    remembered || (!!access.trim() && !!secret.trim()),
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket.trim()) &&
      (!remembered || reuse.jurisdiction === region),
    !publicAccess || validUrl,
    true,
  ][step];
  const summary = [
    [t("Account ID", "账户 ID"), masked(account)],
    [
      t("Access Key ID", "访问密钥 ID"),
      remembered ? t("Saved credentials", "已保存的凭证") : masked(access),
    ],
    [t("Bucket name", "存储桶名称"), bucket],
    [t("Region", "区域"), region === "default" ? "auto" : region],
    [t("Public access", "公开访问"), publicAccess ? publicUrl : t("Disabled", "禁用")],
  ];
  async function syncBucket() {
    setSync("running");
    try {
      await saved();
      setSync("done");
    } catch {
      setSync("failed");
    }
  }
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await p.api.connect({
        id: "",
        accountId: account.trim(),
        bucket: bucket.trim(),
        label: bucket.trim(),
        jurisdiction: region,
        publicBase: publicAccess ? publicUrl.trim() : "",
        credentials: {
          accessKeyId: access,
          secretAccessKey: secret,
          sessionToken: session || undefined,
        },
        reuseCredentialsFrom: remembered ? reuse.id : undefined,
        remember,
      });
      setDone(true);
      void syncBucket();
    } catch (e) {
      setError(connectionFailure(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bucket-wizard">
      <button className="button wizard-back" disabled={busy} onClick={() => void close()}>
        <ArrowLeft size={15} /> {t("Back", "返回")}
      </button>
      {done ? (
        <section className="wizard-success">
          <span className="setup-symbol">
            <CircleCheck size={40} />
          </span>
          <h1>{t("Bucket added successfully!", "存储桶添加成功！")}</h1>
          <p>
            {bucket} {t("is now connected", "已成功配置")}
          </p>
          <div className={"notice wizard-sync " + (sync === "failed" ? "error" : "")} role="status">
            {sync === "running"
              ? t("Initial sync in progress…", "初始同步正在进行中…")
              : sync === "done"
                ? t("Initial sync complete", "初始同步完成")
                : t("Initial sync failed", "初始同步失败")}
          </div>
          <dl className="wizard-summary">
            {summary.slice(2).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="row gap wizard-result-actions">
            {sync === "failed" && (
              <button className="button" onClick={() => void syncBucket()}>
                {t("Retry sync", "重试同步")}
              </button>
            )}
            <button className="button primary" onClick={() => void close()}>
              {t("Return to list", "返回列表")}
            </button>
          </div>
        </section>
      ) : (
        <div className="wizard-content">
          <header>
            <h1>{t("Add a new bucket", "添加新存储桶")}</h1>
            <p>{t("Configure a Cloudflare R2 bucket", "配置新的 Cloudflare R2 存储桶")}</p>
          </header>
          <ol className="wizard-steps" aria-label={t("Setup steps", "配置步骤")}>
            {steps.map(([Mark, label], i) => (
              <li
                key={label}
                className={i < step ? "done" : i === step ? "current" : ""}
                aria-current={i === step ? "step" : undefined}
              >
                <span>{i < step ? <Check size={17} /> : <Mark size={18} />}</span>
                {label}
              </li>
            ))}
          </ol>
          <form
            className="wizard-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid || busy) return;
              if (step === 4) void save();
              else {
                setStep(step + 1);
                setError(undefined);
              }
            }}
          >
            <section className="wizard-card stack">
              <header>
                <Icon size={30} />
                <h2>{step === 4 ? t("Review configuration", "审查配置") : title}</h2>
                <p>{detail}</p>
              </header>
              {step === 0 && (
                <>
                  <label>
                    {t("Account ID", "账户 ID")} <span className="required">*</span>
                    <input
                      required
                      autoComplete="off"
                      spellCheck={false}
                      value={account}
                      placeholder={t(
                        "Enter your Cloudflare Account ID",
                        "请输入 Cloudflare 账户 ID",
                      )}
                      onChange={(e) => {
                        setAccount(e.target.value);
                        setReuse(undefined);
                      }}
                    />
                  </label>
                  {accounts.length > 0 && (
                    <div className="wizard-accounts stack">
                      <span>{t("Saved accounts", "已保存的账户")}</span>
                      {accounts.map((item) => (
                        <div key={item.id} className="row gap">
                          <button
                            className="button"
                            type="button"
                            aria-pressed={reuse?.id === item.id}
                            onClick={() => {
                              setReuse(item);
                              setAccount(item.accountId);
                              setRegion(item.jurisdiction);
                              setAccess("");
                              setSecret("");
                              setSession("");
                            }}
                          >
                            <strong>{item.label}</strong>
                            <small>{masked(item.accountId)}</small>
                          </button>
                          {!linkedAccounts.includes(item.id) && (
                            <button
                              className="button ghost danger-text"
                              type="button"
                              onClick={() => {
                                setForgetError("");
                                setForget(item);
                              }}
                            >
                              {t("Forget account", "忘记账户")}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  {remembered && (
                    <div className="notice">
                      {t("Using saved credentials for this account", "使用此账户已保存的凭证")}
                    </div>
                  )}
                  <div className="wizard-field">
                    <label htmlFor="wizard-access">
                      {t("Access Key ID", "访问密钥 ID")}{" "}
                      <span className="required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <span className="wizard-input">
                      <input
                        id="wizard-access"
                        required={!remembered}
                        type={showAccess ? "text" : "password"}
                        autoComplete="off"
                        value={access}
                        placeholder={remembered ? "••••••••" : ""}
                        onChange={(e) => setAccess(e.target.value)}
                      />
                      <button
                        type="button"
                        className="button"
                        onClick={() => setShowAccess(!showAccess)}
                        aria-label={
                          showAccess
                            ? t("Hide access key ID", "隐藏访问密钥 ID")
                            : t("Show access key ID", "显示访问密钥 ID")
                        }
                      >
                        {showAccess ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </div>
                  <div className="wizard-field">
                    <label htmlFor="wizard-secret">
                      {t("Secret Access Key", "访问密钥")}{" "}
                      <span className="required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <span className="wizard-input">
                      <input
                        id="wizard-secret"
                        required={!remembered}
                        type={showSecret ? "text" : "password"}
                        autoComplete="new-password"
                        value={secret}
                        placeholder={remembered ? "••••••••" : ""}
                        onChange={(e) => setSecret(e.target.value)}
                      />
                      <button
                        type="button"
                        className="button"
                        onClick={() => setShowSecret(!showSecret)}
                        aria-label={
                          showSecret
                            ? t("Hide secret key", "隐藏访问密钥")
                            : t("Show secret key", "显示访问密钥")
                        }
                      >
                        {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </div>
                  {!remembered && (
                    <details>
                      <summary>{t("Temporary credentials", "临时凭证")}</summary>
                      <label className="detail-fields">
                        Session token{" "}
                        <input
                          type="password"
                          autoComplete="off"
                          value={session}
                          onChange={(e) => setSession(e.target.value)}
                        />
                      </label>
                    </details>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    {t("Remember credentials on this device", "在此设备上记住凭据")}
                  </label>
                </>
              )}
              {step === 2 && (
                <>
                  <label>
                    {t("Bucket name", "存储桶名称")} <span className="required">*</span>
                    <input
                      required
                      autoComplete="off"
                      spellCheck={false}
                      value={bucket}
                      placeholder={t("Enter the bucket name", "请输入存储桶名称")}
                      onChange={(e) => setBucket(e.target.value)}
                    />
                    <small>
                      {t(
                        "Use lowercase letters, numbers, and hyphens",
                        "只能包含小写字母、数字和连字符",
                      )}
                    </small>
                  </label>
                  <label>
                    {t("Region", "区域")}
                    <select
                      value={region}
                      disabled={remembered}
                      onChange={(e) => setRegion(e.target.value as typeof region)}
                    >
                      <option value="default">{t("Auto", "自动")}</option>
                      <option value="eu">EU</option>
                      <option value="fedramp">FedRAMP</option>
                    </select>
                  </label>
                </>
              )}
              {step === 3 && (
                <>
                  <label className="check wizard-public">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={publicAccess}
                      onChange={(e) => setPublicAccess(e.target.checked)}
                    />
                    {t("Enable public access", "启用公开访问")}
                  </label>
                  {publicAccess ? (
                    <label>
                      {t("Public URL", "公开访问地址")}
                      <input
                        type="url"
                        value={publicUrl}
                        required
                        placeholder="https://cdn.example.com"
                        onChange={(e) => setPublicUrl(e.target.value)}
                      />
                      <small>
                        {t(
                          "Enter the public URL already configured for this bucket",
                          "填写该存储桶已配置的公开地址",
                        )}
                      </small>
                    </label>
                  ) : (
                    <div className="notice">
                      {t("This bucket will be configured as private", "此存储桶将按私有方式配置")}
                    </div>
                  )}
                </>
              )}
              {step === 4 && (
                <>
                  <dl className="wizard-summary">
                    {summary.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {error && (
                    <div role="alert" className="notice error">
                      {error.message}
                    </div>
                  )}
                  {error?.credentials && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setStep(1);
                        setError(undefined);
                      }}
                    >
                      {t("Edit credentials", "修改凭据")}
                    </button>
                  )}
                  <button className="button primary" disabled={busy}>
                    {busy ? t("Validating…", "正在验证…") : t("Validate and save", "验证并保存")}
                  </button>
                </>
              )}
            </section>
            <footer className="wizard-navigation">
              <button
                type="button"
                className="button"
                disabled={!step || busy}
                onClick={() => {
                  setStep(step - 1);
                  setError(undefined);
                }}
              >
                <ArrowLeft size={15} /> {t("Previous step", "上一步")}
              </button>
              <div className="row gap">
                {step === 3 && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setPublicAccess(false);
                      setStep(4);
                    }}
                  >
                    {t("Skip", "跳过")}
                  </button>
                )}
                {step < 4 && (
                  <button className="button primary" disabled={!valid}>
                    {t("Next step", "下一步")} <ArrowRight size={15} />
                  </button>
                )}
              </div>
            </footer>
          </form>
        </div>
      )}
      {forget && (
        <Modal title={t("Forget account", "忘记账户")} open onClose={() => setForget(undefined)}>
          <div className="dialog-body stack">
            <p>
              {forget.label} ·{" "}
              {t("Remove the credentials saved on this device?", "移除此设备上保存的凭据？")}
            </p>
            {forgetError && <p role="alert">{forgetError}</p>}
            <div className="row end gap">
              <button className="button" onClick={() => setForget(undefined)}>
                {t("Cancel", "取消")}
              </button>
              <button
                className="button danger"
                onClick={() => {
                  void forgetAccount(forget.id)
                    .then(() => {
                      if (reuse?.id === forget.id) {
                        setReuse(undefined);
                        setAccount("");
                      }
                      setForget(undefined);
                    })
                    .catch((e: unknown) =>
                      setForgetError(e instanceof Error ? e.message : String(e)),
                    );
                }}
              >
                {t("Forget", "忘记")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
