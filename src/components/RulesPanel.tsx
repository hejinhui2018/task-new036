import type { RegionRule } from '../types';
import type { Action } from '../state/store';

interface Props {
  rules: RegionRule[];
  dispatch: (a: Action) => void;
}

export function RulesPanel({ rules, dispatch }: Props) {
  return (
    <div className="card">
      <h2>地区规则</h2>
      <p className="muted">
        不同地区沿用各自的同意规则：迁移时的继承/重新确认、合并策略、撤回是否级联下游，都按用户所在地区判定。
        没有匹配规则的地区会在「冲突」页报告为地区不匹配。
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>地区代码</th>
            <th>同意模式</th>
            <th>新用途需显式同意</th>
            <th>拆分后需重新确认</th>
            <th>合并策略</th>
            <th>撤回级联下游</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input mono"
                  value={r.region}
                  onChange={(e) =>
                    dispatch({ type: 'rule/update', index: i, patch: { region: e.target.value } })
                  }
                />
              </td>
              <td>
                <select
                  className="select"
                  value={r.model}
                  onChange={(e) =>
                    dispatch({
                      type: 'rule/update',
                      index: i,
                      patch: { model: e.target.value as RegionRule['model'] },
                    })
                  }
                >
                  <option value="opt-in">opt-in（默认拒绝）</option>
                  <option value="opt-out">opt-out（默认同意）</option>
                </select>
              </td>
              <td className="center">
                <input
                  type="checkbox"
                  checked={r.requireExplicitForNew}
                  onChange={(e) =>
                    dispatch({
                      type: 'rule/update',
                      index: i,
                      patch: { requireExplicitForNew: e.target.checked },
                    })
                  }
                />
              </td>
              <td className="center">
                <input
                  type="checkbox"
                  checked={r.splitRequiresReconfirm}
                  onChange={(e) =>
                    dispatch({
                      type: 'rule/update',
                      index: i,
                      patch: { splitRequiresReconfirm: e.target.checked },
                    })
                  }
                />
              </td>
              <td>
                <select
                  className="select"
                  value={r.mergeStrategy}
                  onChange={(e) =>
                    dispatch({
                      type: 'rule/update',
                      index: i,
                      patch: { mergeStrategy: e.target.value as RegionRule['mergeStrategy'] },
                    })
                  }
                >
                  <option value="all">全部同意才继承</option>
                  <option value="any">任一同意即继承</option>
                </select>
              </td>
              <td className="center">
                <input
                  type="checkbox"
                  checked={r.cascadeWithdraw}
                  onChange={(e) =>
                    dispatch({
                      type: 'rule/update',
                      index: i,
                      patch: { cascadeWithdraw: e.target.checked },
                    })
                  }
                />
              </td>
              <td>
                <button
                  className="btn danger-text"
                  onClick={() => dispatch({ type: 'rule/remove', index: i })}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" onClick={() => dispatch({ type: 'rule/add' })}>
        + 新增地区规则
      </button>
    </div>
  );
}
