import { useState } from 'react';
import { useStore } from '../state/StoreContext';
import { ancestorChain, leafPurposes, purposeMap } from '../core/graph';
import { uid } from '../core/id';
import type { PrivacyVersion, Purpose, PurposeId, PurposeMapping } from '../core/types';
import { VersionStatusBadge } from '../components/Badges';
import { MappingsEditor } from './MappingsEditor';

export function VersionsPage() {
  const { state } = useStore();
  const [selectedId, setSelectedId] = useState(
    state.data.versions.find((v) => v.status === 'draft')?.id ?? state.data.versions[0]?.id,
  );
  const version = state.data.versions.find((v) => v.id === selectedId) ?? state.data.versions[0];

  if (!version) return <div className="card">暂无版本，请先新建。</div>;
  const frozen = version.status === 'published';

  return (
    <div className="grid-3-2">
      <div>
        <div className="card">
          <div className="section-title">
            说明版本
            <VersionStatusBadge status={version.status} />
            <span className="spacer" />
            <VersionSelector selectedId={version.id} onSelect={setSelectedId} />
          </div>
          <VersionMetaForm version={version} frozen={frozen} />
        </div>

        <div className="card">
          <div className="section-title">
            用途层级
            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
              组节点用于归类；同意挂在叶子用途上；dependsOn 声明本用途依赖的上游（上游撤回会级联到本用途）
            </span>
          </div>
          {frozen && (
            <p className="desc" style={{ color: 'var(--warn)' }}>
              该版本已发布冻结，用途不可改动。需要调整请基于它创建新版本（分叉）。
            </p>
          )}
          <PurposeTree version={version} frozen={frozen} />
        </div>
      </div>

      <div>
        <MappingsEditor version={version} frozen={frozen} />
      </div>
    </div>
  );
}

function VersionSelector({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { state } = useStore();
  return (
    <select value={selectedId} onChange={(e) => onSelect(e.target.value)}>
      {[...state.data.versions]
        .sort((a, b) => a.sequence - b.sequence)
        .map((v) => (
          <option key={v.id} value={v.id}>
            seq {v.sequence} · {v.label}（{v.status === 'published' ? '已发布' : '草稿'}）
          </option>
        ))}
    </select>
  );
}

function VersionMetaForm({ version, frozen }: { version: PrivacyVersion; frozen: boolean }) {
  const { dispatch } = useStore();
  const [label, setLabel] = useState(version.label);
  const [parentId, setParentId] = useState(version.parentVersionId ?? '');
  const { state } = useStore();

  // 切换版本时同步表单
  const formKey = version.id;

  return (
    <div key={formKey}>
      <div className="field-row">
        <div className="field">
          <label>版本 ID（不可改）</label>
          <input value={version.id} disabled />
        </div>
        <div className="field">
          <label>序号 sequence</label>
          <input
            type="number"
            defaultValue={version.sequence}
            disabled={frozen}
            onChange={(e) =>
              dispatch({
                type: 'version/update',
                versionId: version.id,
                patch: { sequence: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label>显示名称</label>
          <input
            value={label}
            disabled={frozen}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              if (label !== version.label) {
                dispatch({
                  type: 'version/update',
                  versionId: version.id,
                  patch: { label },
                });
              }
            }}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label>父版本（决定迁移链；改到旁支即制造版本分叉）</label>
          <select
            value={parentId}
            disabled={frozen}
            onChange={(e) => {
              const value = e.target.value || null;
              setParentId(e.target.value);
              dispatch({
                type: 'version/update',
                versionId: version.id,
                patch: { parentVersionId: value },
              });
            }}
          >
            <option value="">（根版本）</option>
            {state.data.versions
              .filter((v) => v.id !== version.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
          </select>
        </div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <label>&nbsp;</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {!frozen ? (
              <button
                className="btn primary"
                onClick={() =>
                  dispatch({ type: 'version/publish', versionId: version.id })
                }
              >
                发布并冻结
              </button>
            ) : (
              <ForkButton version={version} />
            )}
            {!frozen && (
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm(`删除草稿版本「${version.label}」？相关映射也会删除。`)) {
                    dispatch({ type: 'version/delete', versionId: version.id });
                  }
                }}
              >
                删除草稿
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ForkButton({ version }: { version: PrivacyVersion }) {
  const { state, dispatch } = useStore();
  const fork = () => {
    const newId = prompt('新版本 ID', `v${version.id}-fork`);
    if (!newId) return;
    const maxSeq = Math.max(...state.data.versions.map((v) => v.sequence));
    const newVersion: PrivacyVersion = {
      id: newId,
      label: `${version.label} · 分叉草稿`,
      sequence: maxSeq + 1,
      parentVersionId: version.id,
      status: 'draft',
      createdAt: new Date().toISOString(),
      // 拷贝用途（重新挂到新版本）
      purposes: version.purposes.map((p) => ({ ...p, versionId: newId })),
    };
    // 分叉不自动拷贝映射（用户可在映射编辑器里补）
    dispatch({
      type: 'version/fork',
      versionId: version.id,
      newVersion,
      carriedMappings: [],
    });
  };
  return (
    <button className="btn" onClick={fork}>
      基于此版本创建草稿分叉
    </button>
  );
}

// ---------- 用途树 ---------- //

function PurposeTree({ version, frozen }: { version: PrivacyVersion; frozen: boolean }) {
  const { dispatch } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);

  const roots = version.purposes.filter((p) => !p.parentId);

  const addPurpose = (parentId: PurposeId | null, isGroup: boolean) => {
    const id = prompt(isGroup ? '新用途组 ID' : '新叶子用途 ID');
    if (!id) return;
    if (version.purposes.some((p) => p.id === id)) {
      alert('该 ID 已存在。');
      return;
    }
    const purpose: Purpose = {
      id,
      name: id,
      versionId: version.id,
      isGroup,
      parentId,
    };
    dispatch({ type: 'purpose/add', versionId: version.id, purpose });
    setEditingId(id);
  };

  const renderNode = (p: Purpose, depth: number): React.ReactNode => {
    const children = version.purposes.filter((c) => c.parentId === p.id);
    const leaves = new Set(leafPurposes(version.purposes).map((x) => x.id));
    return (
      <li key={p.id}>
        <div className="tree-node">
          <strong>{p.name}</strong>
          <span className="purpose-id">{p.id}</span>
          {p.isGroup && <span className="badge neutral">组</span>}
          {leaves.has(p.id) && <span className="badge neutral">叶子</span>}
          {p.dependsOn && p.dependsOn.length > 0 && (
            <span className="dep-chip">依赖上游: {p.dependsOn.join(', ')}</span>
          )}
          {!frozen && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {p.isGroup && (
                <button className="btn sm ghost" onClick={() => addPurpose(p.id, false)}>
                  + 叶子
                </button>
              )}
              <button className="btn sm ghost" onClick={() => setEditingId(p.id)}>
                编辑
              </button>
              <button
                className="btn sm ghost"
                onClick={() => {
                  if (confirm(`删除用途「${p.name}」？相关层级引用与映射会被清理。`)) {
                    dispatch({
                      type: 'purpose/delete',
                      versionId: version.id,
                      purposeId: p.id,
                    });
                  }
                }}
              >
                删除
              </button>
            </span>
          )}
        </div>
        {editingId === p.id && (
          <PurposeEditor
            version={version}
            purpose={p}
            onClose={() => setEditingId(null)}
          />
        )}
        {children.length > 0 && (
          <ul className="tree-children">
            {children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div>
      <ul className="tree-list">
        {roots.map((p) => renderNode(p, 0))}
      </ul>
      {!frozen && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn sm" onClick={() => addPurpose(null, false)}>
            + 根叶子用途
          </button>
          <button className="btn sm" onClick={() => addPurpose(null, true)}>
            + 根用途组
          </button>
        </div>
      )}
    </div>
  );
}

function PurposeEditor({
  version,
  purpose,
  onClose,
}: {
  version: PrivacyVersion;
  purpose: Purpose;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(purpose.name);
  const [parentId, setParentId] = useState(purpose.parentId ?? '');
  const [dependsOn, setDependsOn] = useState((purpose.dependsOn ?? []).join(', '));
  const [description, setDescription] = useState(purpose.description ?? '');
  const [isGroup, setIsGroup] = useState(!!purpose.isGroup);
  const byId = purposeMap(version.purposes);

  const save = () => {
    // 不允许把自己/后代设为父级（会形成层级环）
    if (parentId) {
      let ancestor: Purpose | undefined = byId.get(parentId);
      while (ancestor) {
        if (ancestor.id === purpose.id) {
          alert('不能把用途挂到自己或自己的子级下（会形成层级环）。');
          return;
        }
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
      }
    }
    const depIds = dependsOn
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (depIds.includes(purpose.id)) {
      alert('dependsOn 不能包含自身（自环）。');
      return;
    }
    dispatch({
      type: 'purpose/update',
      versionId: version.id,
      purposeId: purpose.id,
      patch: {
        name,
        parentId: parentId || null,
        dependsOn: depIds.length ? depIds : undefined,
        description: description || undefined,
        isGroup,
      },
    });
    onClose();
  };

  return (
    <div
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 6,
        padding: 12,
        margin: '6px 0 10px',
        background: 'var(--surface-2)',
      }}
    >
      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>父级用途组</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">（无 / 根节点）</option>
            {version.purposes
              .filter((p) => p.id !== purpose.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {[...ancestorChain(version.purposes, p.id).map((a) => a.name), p.name].join(' / ')}
                </option>
              ))}
          </select>
        </div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <label>类型</label>
          <select
            value={isGroup ? 'group' : 'leaf'}
            onChange={(e) => setIsGroup(e.target.value === 'group')}
          >
            <option value="leaf">叶子（持有同意）</option>
            <option value="group">用途组</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>dependsOn 依赖的上游用途（逗号分隔用途 ID）。这些上游全部失效时，本用途随之失效；撤回上游会级联影响本用途</label>
        <input value={dependsOn} onChange={(e) => setDependsOn(e.target.value)} placeholder="marketing" />
      </div>
      <div className="field">
        <label>说明</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm primary" onClick={save}>保存</button>
        <button className="btn sm" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

/** 供映射编辑器等复用：新建一条空映射的工厂 */
export function newMapping(from: string, to: string): PurposeMapping {
  return {
    id: uid('map'),
    fromVersionId: from,
    toVersionId: to,
    sourcePurposeId: '',
    targetPurposeId: '',
  };
}
