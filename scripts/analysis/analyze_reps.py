#!/usr/bin/env python3
"""Análise com repetições: transforma results/results.json nas tabelas e figuras do TCC.

Espera execuções nomeadas <slug>-<p1|p2>-r<k> (ex.: fable-5-1-p2-r3) e a execução
`ceiling`. Execuções com outro nome (piloto) são ignoradas na análise principal.

Uso:
  python3 scripts/analysis/analyze_reps.py [--results results/results.json] [--out ../tcc/projeto]

Saídas (em --out):
  tabelas/tab_consolidada.tex   teto + média ± dp por condição (Tabela do artigo)
  tabelas/tab_gaps.tex          distância média até o teto por dimensão, com IC 95% (bootstrap)
  tabelas/tab_estabilidade.tex  dispersão entre gerações, k necessário, concordância de ordenamento
  figuras/fig_r_por_condicao.pdf  escore de mutação das gerações por condição + teto
  figuras/fig_gap_dimensao.pdf    distância por dimensão, P1 vs P2, por modelo
  resultados_resumo.json          números-chave para o texto
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

RUN_RE = re.compile(r"^(?P<slug>.+)-(?P<prompt>p[12])-r(?P<rep>\d+)$")

LABELS = {
    "fable-5-1": "Fable 5.1",
    "gemini-pro": "Gemini Pro",
    "deepseek-v4-1-flash": "DeepSeek V4.1 Flash",
}
MODEL_ORDER = ["fable-5-1", "gemini-pro", "deepseek-v4-1-flash"]

# métricas: chave no results.json -> (rótulo, sentido: +1 maior é melhor, -1 menor é melhor)
METRICS = {
    "coverageLines": ("Cob.L", +1),
    "coverageBranches": ("Cob.R", +1),
    "mutationScore": ("R", +1),
    "precision": ("P", +1),
    "f1": ("F$_1$", +1),
    "smellDensity": ("Smells/teste", -1),
}
# cores validadas (dataviz: slots 1 e 2) + neutro para o teto
COLOR = {"p1": "#257de0", "p2": "#f47230", "ceiling": "#0b0b0b"}
MARKER = {"p1": "o", "p2": "s"}
RNG = np.random.default_rng(20261125)
B = 10_000


def load(results: Path) -> tuple[pd.DataFrame, dict | None, list[str]]:
    data = json.loads(results.read_text(encoding="utf-8"))
    rows, ceiling, ignored = [], None, []
    for r in data.get("consolidated", []):
        name = r["run"]
        if name == "ceiling":
            ceiling = r if r.get("scored") else None
            continue
        m = RUN_RE.match(name)
        if not m:
            ignored.append(name)
            continue
        row = {"run": name, "slug": m["slug"], "prompt": m["prompt"], "rep": int(m["rep"]), "scored": bool(r.get("scored"))}
        if r.get("scored"):
            row.update({k: r.get(k) for k in ["tests", "falsePositives", *METRICS.keys(), "smellTotal"]})
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["label"] = df["slug"].map(lambda s: LABELS.get(s, s))
        order = {s: i for i, s in enumerate(MODEL_ORDER)}
        df["order"] = df["slug"].map(lambda s: order.get(s, 99))
        df = df.sort_values(["order", "slug", "prompt", "rep"]).reset_index(drop=True)
    return df, ceiling, ignored


def boot_ci(x: np.ndarray, stat=np.mean, b: int = B) -> tuple[float, float]:
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    if len(x) < 2:
        return (float("nan"), float("nan"))
    idx = RNG.integers(0, len(x), size=(b, len(x)))
    s = stat(x[idx], axis=1)
    return (float(np.percentile(s, 2.5)), float(np.percentile(s, 97.5)))


def cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    a, b = np.asarray(a, float), np.asarray(b, float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if len(a) == 0 or len(b) == 0:
        return float("nan")
    diff = a[:, None] - b[None, :]
    return float((np.sum(diff > 0) - np.sum(diff < 0)) / (len(a) * len(b)))


def fmt(v: float, nd: int = 1) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "--"
    return f"{v:.{nd}f}".replace(".", ",")


def pm(mean: float, sd: float, nd: int = 1) -> str:
    if math.isnan(mean):
        return "--"
    if math.isnan(sd):
        return fmt(mean, nd)
    return f"{fmt(mean, nd)} $\\pm$ {fmt(sd, nd)}"


def table_env(caption: str, label: str, colspec: str, header: str, body: str, note: str = "") -> str:
    legend = "Fonte: Própria do autor (2026)." + (" " + note if note else "")
    return (
        "\\begin{table}[htb]\n    \\centering\n    \\ABNTEXfontereduzida\n    \\begin{minipage}{\\textwidth}\n"
        f"        \\caption{{{caption}}}\n        \\label{{{label}}}\n        \\centering\n"
        f"        \\begin{{tabular}}{{{colspec}}}\n            \\toprule\n            {header} \\\\\n            \\midrule\n"
        f"{body}            \\bottomrule\n        \\end{{tabular}}\n        \\legend{{{legend}}}\n    \\end{{minipage}}\n\\end{{table}}\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--results", default=str(here.parent.parent / "results" / "results.json"))
    ap.add_argument("--out", default=str(here.parent.parent.parent / "tcc" / "projeto"))
    ap.add_argument("--target-half-width", type=float, default=2.0, help="semi-amplitude alvo do IC 95%% (p.p.)")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "tabelas").mkdir(parents=True, exist_ok=True)
    (out / "figuras").mkdir(parents=True, exist_ok=True)

    df, ceiling, ignored = load(Path(args.results))
    if ignored:
        print("Ignoradas (fora do padrão <slug>-<p>-r<k>):", ", ".join(ignored))
    if df.empty:
        print("Nenhuma execução com repetições encontrada.")
        return
    scored = df[df["scored"]].copy()
    unscored = df[~df["scored"]]
    if not unscored.empty:
        print("Não executáveis (contam como geradas, sem métricas):", ", ".join(unscored["run"]))
    if ceiling is None:
        print("AVISO: teto não pontuado; distâncias não serão calculadas.")

    conds = scored.groupby(["order", "slug", "label", "prompt"], sort=True)
    summary = {}

    # ---------- Tabela consolidada ----------
    body = ""
    if ceiling:
        body += ("            Teto & -- & 1 & " + " & ".join([
            fmt(ceiling["tests"], 0), fmt(ceiling["falsePositives"], 0), fmt(ceiling["coverageLines"]),
            fmt(ceiling["coverageBranches"]), fmt(ceiling["mutationScore"]), fmt(ceiling["precision"]),
            fmt(ceiling["f1"]), fmt(ceiling["smellDensity"], 2)]) + " \\\\\n            \\midrule\n")
    for (order, slug, label, prompt), g in conds:
        n = len(g)
        cells = [fmt(g["tests"].mean(), 0), fmt(g["falsePositives"].mean(), 1)]
        for key, (lab, _) in METRICS.items():
            nd = 2 if key == "smellDensity" else 1
            cells.append(pm(g[key].mean(), g[key].std(ddof=1) if n > 1 else float("nan"), nd))
        body += f"            {label} & {prompt.upper()} & {n} & " + " & ".join(cells) + " \\\\\n"
        summary[f"{slug}-{prompt}"] = {k: {"mean": float(g[k].mean()), "sd": float(g[k].std(ddof=1)) if n > 1 else None,
                                           "min": float(g[k].min()), "max": float(g[k].max())} for k in METRICS}
        summary[f"{slug}-{prompt}"]["n"] = n
        summary[f"{slug}-{prompt}"]["tests_mean"] = float(g["tests"].mean())
        summary[f"{slug}-{prompt}"]["fp_mean"] = float(g["falsePositives"].mean())
    (out / "tabelas" / "tab_consolidada.tex").write_text(table_env(
        "Teto e condições: média $\\pm$ desvio padrão das gerações pontuadas",
        "tab:consolidada", "llr rr rr rrr r",
        "\\textbf{Condição} & \\textbf{Prompt} & $n$ & \\textbf{Testes} & \\textbf{FP} & \\textbf{Cob.L} & \\textbf{Cob.R} & $R$ & $P$ & $F_1$ & \\textbf{Smells/teste}",
        body, "Cobertura, $R$, $P$ e $F_1$ em \\%; $n$ = gerações pontuadas."), encoding="utf-8")

    # ---------- Tabela de distâncias ----------
    if ceiling:
        body = ""
        gaps_long = []
        for (order, slug, label, prompt), g in conds:
            cells = []
            for key, (lab, sign) in METRICS.items():
                gap = (ceiling[key] - g[key].to_numpy(float)) * sign
                lo, hi = boot_ci(gap)
                nd = 2 if key == "smellDensity" else 1
                cells.append(f"{fmt(gap.mean(), nd)} [{fmt(lo, nd)}; {fmt(hi, nd)}]")
                for v in gap:
                    gaps_long.append({"slug": slug, "label": label, "prompt": prompt, "metric": lab, "key": key, "gap": v})
                summary[f"{slug}-{prompt}"][f"gap_{key}"] = {"mean": float(gap.mean()), "ci": [lo, hi]}
            body += f"            {label} & {prompt.upper()} & " + " & ".join(cells) + " \\\\\n"
        (out / "tabelas" / "tab_gaps.tex").write_text(table_env(
            "Distância média até o teto por dimensão (teto $-$ condição), com IC 95\\% por \\textit{bootstrap}",
            "tab:gaps", "ll rrrrrr",
            "\\textbf{Condição} & \\textbf{Prompt} & $\\Delta$Cob.L & $\\Delta$Cob.R & $\\Delta R$ & $\\Delta P$ & $\\Delta F_1$ & $\\Delta$Smells",
            body, "Valores positivos = abaixo do teto; para smells o sinal é invertido (positivo = mais smells que o teto)."), encoding="utf-8")
        gaps_df = pd.DataFrame(gaps_long)

    # ---------- Efeito do prompt (Cliff) ----------
    cliff = {}
    for slug in scored["slug"].unique():
        a = scored[(scored.slug == slug) & (scored.prompt == "p2")]
        b = scored[(scored.slug == slug) & (scored.prompt == "p1")]
        cliff[slug] = {k: cliffs_delta(a[k], b[k]) for k in ["mutationScore", "f1", "coverageBranches", "smellDensity"]}
    summary["cliff_p2_vs_p1"] = cliff

    # ---------- Estabilidade ----------
    z = 1.96
    body = ""
    stab = {}
    for (order, slug, label, prompt), g in conds:
        r = g["mutationScore"].to_numpy(float)
        f1 = g["f1"].to_numpy(float)
        n = len(r)
        sd = r.std(ddof=1) if n > 1 else float("nan")
        cv = sd / r.mean() * 100 if r.mean() else float("nan")
        half = z * sd / math.sqrt(n) if n > 1 else float("nan")
        k_needed = math.ceil((z * sd / args.target_half_width) ** 2) if n > 1 else None
        sdf1 = f1.std(ddof=1) if n > 1 else float("nan")
        body += (f"            {label} & {prompt.upper()} & {fmt(r.mean())} & {fmt(sd)} & {fmt(cv)} & "
                 f"{fmt(r.min())}--{fmt(r.max())} & $\\pm${fmt(half)} & {k_needed if k_needed is not None else '--'} & {fmt(sdf1)} \\\\\n")
        stab[f"{slug}-{prompt}"] = {"sd_R": float(sd), "cv_R": float(cv), "range_R": [float(r.min()), float(r.max())],
                                     "half_width_R": float(half), "k_needed_R": k_needed, "sd_F1": float(sdf1)}
    # concordância de ordenamento: uma geração ao acaso por condição vs. ordenamento pelas médias
    keys = [f"{slug}-{prompt}" for (order, slug, label, prompt), g in conds]
    arrays = [g["mutationScore"].to_numpy(float) for _, g in conds]
    means = np.array([a.mean() for a in arrays])
    mean_rank = np.argsort(-means)
    same, taus = 0, []
    from itertools import combinations
    pairs = list(combinations(range(len(arrays)), 2))
    for _ in range(B):
        draw = np.array([a[RNG.integers(len(a))] for a in arrays])
        rank = np.argsort(-draw)
        same += int(np.array_equal(rank, mean_rank))
        conc = sum(1 for i, j in pairs if np.sign(draw[i] - draw[j]) == np.sign(means[i] - means[j]))
        disc = len(pairs) - conc
        taus.append((conc - disc) / len(pairs) if pairs else float("nan"))
    agree = same / B
    tau = float(np.mean(taus)) if taus else float("nan")
    # concordância par a par (P2 > P1 dentro de cada modelo)
    p2_beats_p1 = {}
    for slug in scored["slug"].unique():
        a = scored[(scored.slug == slug) & (scored.prompt == "p2")]["mutationScore"].to_numpy(float)
        b = scored[(scored.slug == slug) & (scored.prompt == "p1")]["mutationScore"].to_numpy(float)
        if len(a) and len(b):
            p2_beats_p1[slug] = float(np.mean(a[:, None] > b[None, :]))
    note = (f"Concordância do ordenamento completo das condições por $R$ ao tomar uma geração ao acaso por condição: "
            f"{fmt(agree*100)}\\% das amostras reproduzem o ordenamento pelas médias ($\\tau$ médio de Kendall = {fmt(tau, 2)}). "
            f"$k^*$: gerações necessárias para semi-amplitude de {fmt(args.target_half_width)} p.p. no IC 95\\% de $R$.")
    (out / "tabelas" / "tab_estabilidade.tex").write_text(table_env(
        "Estabilidade entre gerações: dispersão do escore de mutação por condição",
        "tab:estabilidade", "ll rrr r r r r",
        "\\textbf{Condição} & \\textbf{Prompt} & $\\bar{R}$ & dp & CV (\\%) & mín.--máx. & IC 95\\% & $k^*$ & dp $F_1$",
        body, note), encoding="utf-8")
    summary["estabilidade"] = stab
    summary["ordenamento"] = {"concordancia_total": agree, "tau_medio": tau, "p2_maior_que_p1_por_modelo": p2_beats_p1}

    # ---------- Figura 1: R por condição ----------
    plt.rcParams.update({"font.size": 9, "font.family": "serif", "axes.spines.top": False, "axes.spines.right": False,
                         "axes.edgecolor": "#555555", "axes.labelcolor": "#111111", "xtick.color": "#333333", "ytick.color": "#333333"})
    labels_models = [l for l in dict.fromkeys(scored.sort_values("order")["label"])]
    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    xs, xt = [], []
    for i, lab in enumerate(labels_models):
        for j, p in enumerate(["p1", "p2"]):
            g = scored[(scored.label == lab) & (scored.prompt == p)]["mutationScore"].to_numpy(float)
            x = i * 3 + j
            jitter = (RNG.random(len(g)) - 0.5) * 0.35
            ax.scatter(np.full(len(g), x) + jitter, g, s=28, marker=MARKER[p], facecolor=COLOR[p], edgecolor="#ffffff", linewidth=0.8, zorder=3,
                       label=p.upper() if i == 0 else None)
            if len(g):
                ax.hlines(g.mean(), x - 0.3, x + 0.3, color="#333333", linewidth=1.2, zorder=4)
                ax.annotate(fmt(g.mean()), (x, g.mean()), textcoords="offset points", xytext=(0, 7 if p == "p2" else -11), ha="center", fontsize=7.5, color="#111111")
            xs.append(x); xt.append(f"{p.upper()}")
    if ceiling:
        ax.axhline(ceiling["mutationScore"], color=COLOR["ceiling"], linestyle="--", linewidth=1.0, zorder=2)
        ax.annotate(f"teto {fmt(ceiling['mutationScore'])}", (ax.get_xlim()[1] if xs else 1, ceiling["mutationScore"]), xytext=(-4, 3),
                    textcoords="offset points", ha="right", fontsize=7.5, color="#111111")
    ax.set_xticks(xs); ax.set_xticklabels(xt)
    for i, lab in enumerate(labels_models):
        ax.text(i * 3 + 0.5, -0.16, lab, transform=ax.get_xaxis_transform(), ha="center", va="top", fontsize=8.5, color="#111111")
    ax.set_ylabel("Escore de mutação $R$ (%)")
    ax.yaxis.grid(True, color="#e6e6e6", linewidth=0.6); ax.set_axisbelow(True)
    ax.legend(frameon=False, loc="lower left", fontsize=8, title=None)
    fig.tight_layout(); fig.savefig(out / "figuras" / "fig_r_por_condicao.pdf"); fig.savefig(out / "figuras" / "fig_r_por_condicao.png", dpi=160); plt.close(fig)

    # ---------- Figura 2: distância por dimensão, P1 vs P2, por modelo ----------
    if ceiling:
        dims = [lab for key, (lab, _) in METRICS.items() if key != "smellDensity"]
        fig, axes = plt.subplots(1, len(labels_models), figsize=(6.3, 2.6), sharey=True, squeeze=False)
        for ax, lab in zip(axes[0], labels_models):
            for j, p in enumerate(["p1", "p2"]):
                sub = gaps_df[(gaps_df.label == lab) & (gaps_df.prompt == p) & (gaps_df.key != "smellDensity")]
                means_d = [sub[sub.metric == d]["gap"].mean() for d in dims]
                errs = [abs(np.subtract(boot_ci(sub[sub.metric == d]["gap"].to_numpy(float)), sub[sub.metric == d]["gap"].mean())) if len(sub[sub.metric == d]) > 1 else (0, 0) for d in dims]
                err = np.array(errs).T if len(errs) else None
                xpos = np.arange(len(dims)) + (j - 0.5) * 0.38
                ax.bar(xpos, means_d, width=0.34, color=COLOR[p], edgecolor="#ffffff", linewidth=0.8, label=p.upper(),
                       yerr=err if err is not None else None, error_kw={"elinewidth": 0.8, "ecolor": "#333333", "capsize": 1.5})
            short = {"Cob.L": "Cob.\nlinhas", "Cob.R": "Cob.\nramos", "F$_1$": "$F_1$"}
            ax.set_title(lab, fontsize=9); ax.set_xticks(np.arange(len(dims))); ax.set_xticklabels([short.get(d, d) for d in dims], fontsize=7.5)
            ax.axhline(0, color="#555555", linewidth=0.8); ax.yaxis.grid(True, color="#e6e6e6", linewidth=0.6); ax.set_axisbelow(True)
        axes[0][0].set_ylabel("Distância até o teto (p.p.)")
        axes[0][0].legend(frameon=False, fontsize=8)
        fig.tight_layout(); fig.savefig(out / "figuras" / "fig_gap_dimensao.pdf"); fig.savefig(out / "figuras" / "fig_gap_dimensao.png", dpi=160); plt.close(fig)

    (out / "resultados_resumo.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=float), encoding="utf-8")
    print("Condições:", len(keys), "| gerações pontuadas:", len(scored), "| não executáveis:", len(unscored))
    print(f"Concordância do ordenamento com uma geração ao acaso: {agree*100:.1f}% (tau médio {tau:.2f})")
    for k, v in stab.items():
        print(f"  {k}: R sd={v['sd_R']:.2f} cv={v['cv_R']:.2f}% half={v['half_width_R']:.2f} k*={v['k_needed_R']}")
    print("Saídas em", out)


if __name__ == "__main__":
    main()
