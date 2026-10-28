    /**
     * 批量操作条与空态、错误条、通用弹窗（mask / dialog / actions）。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* —— 「待审核」组底部固定的一排批量操作 —— */
/* 批量操作条：底色加深一档 + 顶部一条更实的强调线，让「全选 / 全部通过 / 全部删除」
   这一排从列表里明确分离出来。 */
.plt-bulk{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:7px 8px;border-top:1px solid rgba(var(--plt-accent),.45);background:linear-gradient(180deg,rgba(var(--plt-accent),.16),rgba(var(--plt-accent),.08));flex-wrap:nowrap;min-width:0}
.plt-bulk .plt-check{flex:0 0 auto;font-size:12.5px;gap:5px;color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:500}
.plt-bulk .plt-check input{width:14px;height:14px}
.plt-bulk-count{flex:1 1 auto;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#c8c8c8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 「全部通过」：实心强调色，跟「开始干活」同一档分量。 */
.plt-bulk-pass{flex:0 0 auto;font-size:12.5px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.7);color:#1b1200;background:linear-gradient(180deg,rgba(var(--plt-accent),.98),rgba(var(--plt-accent),.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(var(--plt-accent),.8)}
.plt-bulk-pass:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(var(--plt-accent),.9)}
.plt-bulk-pass:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-pass:disabled{opacity:.4;cursor:default;box-shadow:none}
/* 「已审核」组底部的批量删除：危险色实心，与「全部通过」区分开。 */
.plt-bulk-danger{border-top-color:rgba(214,68,68,.5);background:linear-gradient(180deg,rgba(214,68,68,.18),rgba(214,68,68,.09))}
.plt-bulk-del{flex:0 0 auto;font-size:12.5px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid rgba(214,68,68,.75);color:#fff;background:linear-gradient(180deg,rgba(214,68,68,.92),rgba(178,48,48,.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(214,68,68,.8)}
.plt-bulk-del:hover:not(:disabled){background:linear-gradient(180deg,rgba(230,80,80,1),rgba(198,56,56,.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(214,68,68,.9)}
.plt-bulk-del:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-del:disabled{opacity:.4;cursor:default;box-shadow:none}
/* 「草稿」组底部的批量转待执行：跟着本组绿色强调，和「全部通过」同款实心胶囊。 */
.plt-bulk-promote{flex:0 0 auto;font-size:12.5px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.7);color:#08160d;background:linear-gradient(180deg,rgba(var(--plt-accent),.98),rgba(var(--plt-accent),.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(var(--plt-accent),.8)}
.plt-bulk-promote:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(var(--plt-accent),.9)}
.plt-bulk-promote:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-promote:disabled{opacity:.4;cursor:default;box-shadow:none}
/* 条目内的「转为待执行 / 转为草稿」：小一号的描边胶囊，别抢删除的视觉重量。 */
.plt-promote,.plt-demote{border-radius:999px;border-color:rgba(var(--plt-accent),.55);color:rgba(var(--plt-accent),1)}
.plt-promote:hover:not(:disabled),.plt-demote:hover:not(:disabled){background:rgba(var(--plt-accent),.14);border-color:rgba(var(--plt-accent),.8)}
/* 条目内的「审核通过」：一次性动作，做成实心胶囊按钮（原来是个复选框，容易被误认为可反复勾选）。 */
.plt-approve{display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:12.5px;font-weight:600;line-height:18px;white-space:nowrap;padding:4px 13px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.7);color:#231a00;background:linear-gradient(180deg,rgba(var(--plt-accent),.98),rgba(var(--plt-accent),.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(var(--plt-accent),.8)}
.plt-approve:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(var(--plt-accent),.9)}
.plt-approve:active:not(:disabled){transform:translateY(1px)}
.plt-approve:disabled{opacity:.45;cursor:default;box-shadow:none}
.plt-approve.is-done{opacity:1;color:rgba(var(--plt-accent),1);background:rgba(var(--plt-accent),.14);border-color:rgba(var(--plt-accent),.5);box-shadow:none;cursor:default}
/* 「开始干活」：待执行组底部的主动作按钮。用本组的粉调做强调，实心填充，比其他按钮更显眼。 */
.plt-bulk-start{border-top-color:rgba(var(--plt-accent),.32);background:rgba(var(--plt-accent),.07)}
.plt-bulk-go{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:12.5px;font-weight:600;line-height:18px;white-space:nowrap;padding:4px 14px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.62);color:#fff;background:linear-gradient(180deg,rgba(var(--plt-accent),.92),rgba(var(--plt-accent),.72));box-shadow:0 1px 2px rgba(0,0,0,.18),0 0 12px -4px rgba(var(--plt-accent),.7)}
/* 图标 + 文案都要单行：窄面板下也不许折成两行。 */
.plt-bulk-go>svg,.plt-bulk-go>span{flex:0 0 auto;white-space:nowrap}
/* 「干活中」：不再是可以点的主动作，改成半透明的进行中状态，转圈图标负责表示活着。 */
.plt-bulk-go.is-working{cursor:default;color:rgba(255,255,255,.92);border-color:rgba(var(--plt-accent),.34);background:rgba(var(--plt-accent),.16);box-shadow:none;opacity:1}
.plt-bulk-go.is-working:disabled{opacity:1}
.plt-bulk-go:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.82));box-shadow:0 1px 3px rgba(0,0,0,.22),0 0 18px -3px rgba(var(--plt-accent),.85)}
.plt-bulk-go:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-go:disabled{opacity:.5;cursor:default}
/* 条目左侧的批量勾选框 */
.plt-pick{flex:0 0 auto;display:inline-flex;align-items:center;margin-right:1px}
.plt-pick input{width:13px;height:13px;cursor:pointer;margin:0}
.plt-pick input:disabled{cursor:default}
.plt-empty{padding:24px 12px;text-align:center;color:var(--dsw-alias-label-caption,#8a8a8a);line-height:1.75;font-size:14px}
/* 空组（比如待审核 0 条）仍然显示组头，展开时把提示图文上下左右居中。 */
.plt-group-empty{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px;color:var(--dsw-alias-label-caption,#8a8a8a);font-size:12.5px;opacity:.8;text-align:center;line-height:1.6}
.plt-group-empty svg{opacity:.6}
.plt-err{margin:6px 10px;padding:7px 10px;border-radius:6px;background:rgba(212,106,106,.12);border:1px solid rgba(212,106,106,.35);color:#e08b8b;line-height:1.55;word-break:break-word;font-size:14px}
.plt-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:20}
.plt-dialog{width:100%;max-width:360px;background:var(--dsw-alias-bg-primary,#1e1e1e);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.14));border-radius:10px;padding:16px;box-shadow:0 12px 32px rgba(0,0,0,.4)}
.plt-dialog h3{margin:0 0 9px;font-size:16px}
.plt-dialog p{margin:0 0 13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#c0c0c0);font-size:14px}
.plt-dialog code{font-size:14px;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.25));padding:1px 4px;border-radius:4px}
.plt-actions{display:flex;gap:8px;justify-content:flex-end}`)
