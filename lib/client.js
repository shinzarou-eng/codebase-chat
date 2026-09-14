window.__ModuleLoader__.load({
  id: "codebase-chat",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");

    const NS = "codebase-chat";
    const inject = ["slots"];
    const LOCALE_KEY = "codebase-locale";

    const UI_LABELS = {
      fr: {
        title: "Codebase Pro",
        badge: "Pro",
        recent: "Récents",
        recentMode: "Mode",
        presets: "Presets",
        presetsHint: "1 clic, réglages auto",
        savePreset: "Sauvegarder le réglage actuel",
        addPreset: "Nom du preset",
        project: "Projet",
        projectPlaceholder: "C:\\MonProjet (laissez vide pour auto-détection)",
        autoDetect: "auto-détection",
        previewLoading: "Aperçu en cours...",
        mode: "Mode d'analyse",
        style: "Style de sortie",
        focus: "Focus (optionnel)",
        focusPlaceholder: "Ex: focus sur le match engine, ou sur l'UI mobile...",
        cancel: "Annuler",
        run: "Lancer l'analyse",
        footer: "Fait avec passion par shinzarou-eng",
        loadingTitle: "Analyse en cours",
        error: "Erreur",
        successTitle: "Analyse lancée",
        successBody: "Le brief a été envoyé. Le rapport apparaîtra dans la session.",
        close: "Fermer",
        sessionRequired: "Sélectionnez une session DSH",
        actionTitle: "Lancer un brief codebase"
      },
      en: {
        title: "Codebase Pro",
        badge: "Pro",
        recent: "Recent",
        recentMode: "Mode",
        presets: "Presets",
        presetsHint: "1 click, auto settings",
        savePreset: "Save current settings",
        addPreset: "Preset name",
        project: "Project",
        projectPlaceholder: "C:\\MyProject (leave empty for auto-detect)",
        autoDetect: "auto-detect",
        previewLoading: "Loading preview...",
        mode: "Analysis mode",
        style: "Output style",
        focus: "Focus (optional)",
        focusPlaceholder: "Ex: focus on the match engine, or the mobile UI...",
        cancel: "Cancel",
        run: "Run analysis",
        footer: "Made with passion by shinzarou-eng",
        loadingTitle: "Analysis in progress",
        error: "Error",
        successTitle: "Analysis started",
        successBody: "The brief has been sent. The report will appear in the session.",
        close: "Close",
        sessionRequired: "Select a DSH session",
        actionTitle: "Start a codebase brief"
      }
    };

    function getLabels(locale) {
      return UI_LABELS[locale] || UI_LABELS.fr;
    }

    const palette = {
      accent: "var(--dsw-alias-accent, #3b82f6)",
      accentGlow: "rgba(59, 130, 246, 0.25)",
      bg: "#16181d",
      card: "#1f2126",
      border: "rgba(255, 255, 255, 0.08)",
      text: "#f3f4f6",
      muted: "#9ca3af",
      success: "#10b981",
      danger: "#ef4444",
      overlay: "rgba(0, 0, 0, 0.6)"
    };

    const styles = {
      button: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        minWidth: 0,
        height: "28px",
        padding: "0 10px",
        color: palette.text,
        font: "inherit",
        fontSize: "13px",
        fontWeight: 500,
        lineHeight: "20px",
        whiteSpace: "nowrap",
        cursor: "pointer",
        background: "rgba(255,255,255,0.06)",
        border: `1px solid ${palette.border}`,
        borderRadius: "24px"
      },
      buttonDisabled: {
        opacity: 0.45,
        cursor: "not-allowed"
      },
      icon: {
        flex: "none",
        width: "15px",
        height: "15px"
      },
      label: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis"
      },
      backdrop: {
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.overlay,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        transition: "opacity 0.2s ease"
      },
      modal: {
        width: "560px",
        maxWidth: "94vw",
        maxHeight: "96vh",
        overflow: "auto",
        padding: "14px",
        borderRadius: "18px",
        background: palette.card,
        border: `1px solid ${palette.border}`,
        boxShadow: "0 24px 80px rgba(0, 0, 0, 0.55)"
      },
      modalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "14px",
        padding: "8px 10px",
        margin: "-14px -14px 14px -14px",
        borderBottom: `1px solid ${palette.border}`,
        background: `linear-gradient(135deg, ${palette.card} 0%, rgba(86,119,252,0.08) 100%)`
      },
      columns: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "18px"
      },
      column: {
        display: "flex",
        flexDirection: "column"
      },
      kbdHint: {
        fontSize: "9px",
        color: palette.muted,
        textAlign: "center",
        marginTop: "6px",
        marginBottom: "-4px"
      },
      miniChip: {
        background: "rgba(86,119,252,0.08)",
        border: `1px solid ${palette.border}`,
        color: palette.text,
        fontSize: "9px",
        borderRadius: "999px",
        padding: "2px 8px",
        cursor: "pointer",
        transition: "all 0.12s"
      },
      ghost: {
        background: "transparent",
        border: "none",
        color: palette.accent,
        fontSize: "16px",
        fontWeight: 700,
        cursor: "pointer",
        padding: "0 6px",
        borderRadius: "6px",
        lineHeight: 1
      },
      badge: {
        fontSize: "9px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "#fff",
        background: palette.accent,
        padding: "2px 6px",
        borderRadius: "4px",
        marginLeft: "6px"
      },
      langSelect: {
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderRadius: "6px",
        padding: "2px 6px",
        fontSize: "11px",
        fontWeight: 600,
        cursor: "pointer",
        outline: "none"
      },
      modalTitle: {
        fontSize: "17px",
        fontWeight: 700,
        color: palette.text,
        letterSpacing: "-0.3px",
        display: "flex",
        alignItems: "center",
        gap: "10px"
      },
      modalClose: {
        width: "28px",
        height: "28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        borderRadius: "50%",
        color: palette.muted,
        cursor: "pointer",
        transition: "background 0.15s ease"
      },
      section: {
        marginBottom: "10px"
      },
      sectionTitle: {
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        color: palette.muted,
        marginBottom: "4px"
      },
      input: {
        width: "100%",
        boxSizing: "border-box",
        padding: "8px 11px",
        fontSize: "12px",
        color: palette.text,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "9px",
        outline: "none"
      },
      inputHint: {
        fontSize: "11px",
        color: palette.muted,
        marginTop: "6px",
        lineHeight: 1.4
      },
      grid: {
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "8px"
      },
      modeCard: (selected) => ({
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "3px",
        padding: "6px",
        textAlign: "left",
        cursor: "pointer",
        background: selected ? "rgba(59, 130, 246, 0.12)" : palette.bg,
        border: selected ? `1.5px solid ${palette.accent}` : `1px solid ${palette.border}`,
        borderRadius: "10px",
        transition: "all 0.15s ease",
        boxShadow: selected ? `0 0 0 1px ${palette.accent}` : "none"
      }),
      modeIcon: {
        width: "20px",
        height: "20px",
        color: palette.accent
      },
      modeTitle: {
        fontSize: "12px",
        fontWeight: 600,
        color: palette.text
      },
      modeDesc: {
        fontSize: "9px",
        color: palette.muted,
        lineHeight: 1.35,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        width: "100%"
      },
      check: {
        position: "absolute",
        top: "10px",
        right: "10px",
        width: "16px",
        height: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: palette.accent,
        color: "#fff",
        fontSize: "10px"
      },
      textarea: {
        width: "100%",
        minHeight: "38px",
        boxSizing: "border-box",
        padding: "8px 11px",
        fontSize: "12px",
        color: palette.text,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "9px",
        outline: "none",
        resize: "vertical",
        fontFamily: "inherit"
      },
      footer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        marginTop: "10px"
      },
      runButton: (disabled) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "10px 18px",
        fontSize: "13px",
        fontWeight: 600,
        color: "#fff",
        background: disabled ? "rgba(59, 130, 246, 0.4)" : palette.accent,
        border: "none",
        borderRadius: "10px",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : `0 4px 14px ${palette.accentGlow}`
      }),
      cancelButton: {
        padding: "10px 14px",
        fontSize: "13px",
        fontWeight: 500,
        color: palette.muted,
        background: "transparent",
        border: "none",
        cursor: "pointer"
      },
      chipRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px"
      },
      chip: (selected) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "5px 9px",
        fontSize: "11px",
        fontWeight: 500,
        color: selected ? "#fff" : palette.muted,
        background: selected ? palette.accent : palette.bg,
        border: `1px solid ${selected ? palette.accent : palette.border}`,
        borderRadius: "20px",
        cursor: "pointer",
        transition: "all 0.15s ease"
      }),
      recentList: {
        display: "flex",
        flexDirection: "column",
        gap: "6px"
      },
      recentItem: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "8px 10px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "9px",
        cursor: "pointer",
        transition: "background 0.15s ease"
      },
      recentPath: {
        fontSize: "11px",
        color: palette.text,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1
      },
      recentMeta: {
        fontSize: "9px",
        color: palette.muted,
        flex: "none"
      },
      previewCard: {
        padding: "8px 10px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "9px",
        marginTop: "8px",
        fontSize: "11px",
        color: palette.text
      },
      previewStats: {
        color: palette.muted,
        fontSize: "10px"
      },
      microFooter: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginTop: "10px",
        padding: "4px 0",
        borderTop: `1px solid ${palette.border}`,
        fontSize: "10px",
        color: palette.muted,
        flexWrap: "wrap"
      },
      proTip: {
        marginTop: "14px",
        padding: "8px 10px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "9px",
        fontSize: "10px",
        color: palette.muted,
        lineHeight: 1.35,
        display: "flex",
        alignItems: "flex-start",
        gap: "8px"
      },
      dannaoFooter: {
        marginTop: "12px",
        paddingTop: "12px",
        borderTop: `1px solid ${palette.border}`,
        fontSize: "11px",
        color: palette.muted,
        textAlign: "center",
        fontStyle: "italic"
      },
      overlay: {
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.overlay,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        transition: "opacity 0.2s ease"
      },
      overlayCard: {
        width: "320px",
        maxWidth: "92vw",
        padding: "36px 32px",
        borderRadius: "16px",
        textAlign: "center",
        background: palette.card,
        border: `1px solid ${palette.border}`,
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)"
      },
      spinnerWrap: {
        position: "relative",
        width: "48px",
        height: "48px",
        margin: "0 auto 22px"
      },
      overlayTitle: {
        fontSize: "15px",
        fontWeight: 600,
        color: palette.text,
        marginBottom: "6px",
        letterSpacing: "-0.15px"
      },
      overlaySubtitle: {
        fontSize: "12px",
        color: palette.muted,
        lineHeight: 1.45,
        wordBreak: "break-word",
        marginBottom: "18px"
      },
      progressTrack: {
        width: "100%",
        height: "3px",
        background: "rgba(255,255,255,0.08)",
        borderRadius: "999px",
        marginBottom: "14px",
        overflow: "hidden"
      },
      progressFill: (pct) => ({
        width: `${pct}%`,
        height: "100%",
        background: palette.accent,
        borderRadius: "999px",
        transition: "width 0.3s ease"
      }),
      progressList: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        textAlign: "left",
        maxHeight: "120px",
        overflow: "hidden",
        fontSize: "11px",
        color: palette.muted
      },
      progressItem: (active) => ({
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 0",
        color: active ? "#e5e7eb" : "#6b7280",
        transition: "color 0.2s ease"
      }),
      successIcon: {
        width: "56px",
        height: "56px",
        margin: "0 auto 22px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: "rgba(16, 185, 129, 0.12)",
        border: "1px solid rgba(16, 185, 129, 0.25)"
      },
      successTitle: {
        fontSize: "17px",
        fontWeight: 700,
        color: palette.text,
        marginBottom: "8px"
      },
      successSubtitle: {
        fontSize: "12px",
        color: palette.muted,
        lineHeight: 1.45,
        wordBreak: "break-word",
        marginBottom: "20px"
      },
      successButton: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "8px 16px",
        fontSize: "12px",
        fontWeight: 600,
        color: "#ffffff",
        background: palette.accent,
        border: "none",
        borderRadius: "8px",
        cursor: "pointer",
        boxShadow: `0 4px 14px ${palette.accentGlow}`
      },
      successTrack: {
        width: "100%",
        height: "3px",
        background: "rgba(255,255,255,0.08)",
        borderRadius: "999px",
        marginTop: "20px",
        overflow: "hidden"
      },
      successFill: (pct) => ({
        width: `${pct}%`,
        height: "100%",
        background: "linear-gradient(90deg, #10b981, #34d399)",
        borderRadius: "999px",
        transition: "width 0.1s linear"
      })
    };

    function CodebaseLogo(props) {
      return jsx("svg", {
        ...props,
        viewBox: "0 0 32 32",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        children: [
          jsx("path", { d: "M6 11 L16 5 L26 11 L26 21 L16 27 L6 21 Z", key: "hex" }),
          jsx("path", { d: "M16 5 L16 15 M16 15 L6 21 M16 15 L26 21", strokeOpacity: "0.5", key: "spokes" }),
          jsx("circle", { cx: "16", cy: "15", r: "3.5", fill: "currentColor", fillOpacity: "0.18", stroke: "currentColor", key: "core" }),
          jsx("circle", { cx: "16", cy: "5", r: "2.2", fill: "currentColor", stroke: "none", key: "n1" }),
          jsx("circle", { cx: "6", cy: "21", r: "2.2", fill: "currentColor", stroke: "none", key: "n2" }),
          jsx("circle", { cx: "26", cy: "21", r: "2.2", fill: "currentColor", stroke: "none", key: "n3" })
        ]
      });
    }

    function CloseIcon(props) {
      return jsx("svg", {
        ...props,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        children: [jsx("path", { d: "M18 6L6 18 M6 6L18 18", key: "x" })]
      });
    }

    function CheckIcon(props) {
      return jsx("svg", {
        ...props,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        children: [jsx("polyline", { points: "20 6 9 17 4 12", key: "check" })]
      });
    }

    function DotIcon(props) {
      return jsx("svg", {
        ...props,
        viewBox: "0 0 24 24",
        fill: "currentColor",
        children: [jsx("circle", { cx: "12", cy: "12", r: "5", key: "dot" })]
      });
    }

    function ModeIcon({ mode, ...props }) {
      if (mode === "intel") {
        return jsx("svg", {
          ...props,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsx("path", { d: "M12 4 L12 14 M12 14 L5 20 M12 14 L19 20", key: "lines" }),
            jsx("circle", { cx: "12", cy: "4", r: "2.5", fill: "currentColor", stroke: "none", key: "top" }),
            jsx("circle", { cx: "5", cy: "20", r: "2.5", fill: "currentColor", stroke: "none", key: "left" }),
            jsx("circle", { cx: "19", cy: "20", r: "2.5", fill: "currentColor", stroke: "none", key: "right" })
          ]
        });
      }
      if (mode === "report") {
        return jsx("svg", {
          ...props,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsx("path", { d: "M4 20 L20 20", key: "base" }),
            jsx("path", { d: "M7 20 L7 14 M12 20 L12 8 M17 20 L17 11", key: "bars" })
          ]
        });
      }
      if (mode === "audit") {
        return jsx("svg", {
          ...props,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsx("circle", { cx: "11", cy: "11", r: "7", key: "ring" }),
            jsx("path", { d: "M20 20 L16 16", key: "handle" })
          ]
        });
      }
      if (mode === "tasks") {
        return jsx("svg", {
          ...props,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsx("path", { d: "M4 7 L10 7 M4 12 L10 12 M4 17 L10 17", key: "rows" }),
            jsx("path", { d: "M14 8 L17 11 L22 5", key: "check" }),
            jsx("path", { d: "M14 13 L17 16 L22 10", key: "check2" }),
            jsx("path", { d: "M14 18 L17 21 L22 15", key: "check3" })
          ]
        });
      }
      if (mode === "player") {
        return jsx("svg", {
          ...props,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.8",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: [
            jsx("path", { d: "M4 20 C8 20 9 14 14 14 C19 14 20 18 20 20", key: "path" }),
            jsx("circle", { cx: "14", cy: "14", r: "3", fill: "currentColor", fillOpacity: "0.2", key: "point" }),
            jsx("circle", { cx: "20", cy: "20", r: "2.2", fill: "currentColor", stroke: "none", key: "end" })
          ]
        });
      }
      return jsx(CodebaseLogo, { ...props });
    }

    function SparklesIcon(props) {
      return jsx("svg", {
        ...props,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        children: [
          jsx("path", { d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z", key: "s" })
        ]
      });
    }

    function getModes(locale) {
      const l = locale === "en" ? {
        intel: { title: "Intelligence Pro", desc: "CTO brief: architecture, tech debt, opportunities, ideas." },
        report: { title: "Strategic Report", desc: "Board-level: SWOT, scorecards, 90-day roadmap." },
        audit: { title: "Non-Compliance Audit", desc: "Debt scan: TODO, any, console.log, proposed fixes." },
        tasks: { title: "TASKS Action Plan", desc: "Generate a TASKS.md with sprints and Before/After." },
        player: { title: "Player / UX", desc: "User journey, friction points, wow moments." }
      } : {
        intel: { title: "Intelligence Pro", desc: "CTO brief : architecture, dette, opportunités, créa." },
        report: { title: "Rapport Stratégique", desc: "Constat board : SWOT, score cards, roadmap 90 jours." },
        audit: { title: "Audit Non-Conformités", desc: "Scan dette : TODO, any, console.log, fix proposés." },
        tasks: { title: "Plan d'Action TASKS", desc: "Génère un TASKS.md avec sprints et Avant/Après." },
        player: { title: "Player / UX", desc: "Parcours utilisateur, frictions, wow moments." }
      };
      return [
        { id: "intel", ...l.intel },
        { id: "report", ...l.report },
        { id: "audit", ...l.audit },
        { id: "tasks", ...l.tasks },
        { id: "player", ...l.player }
      ];
    }

    function getStyleOptions(locale) {
      const l = locale === "en" ? {
        ouf: { label: "Ouf", desc: "Max impact, punchy." },
        punchy: { label: "Punchy", desc: "Direct, hard-hitting." },
        dense: { label: "Dense", desc: "Factual, rich, no-fluff." },
        pedagogique: { label: "Pedagogical", desc: "Clear, progressive, explanatory." },
        minimal: { label: "Minimal", desc: "Short, essential, bullet points." }
      } : {
        ouf: { label: "Ouf", desc: "Impact maximal, punchy." },
        punchy: { label: "Punchy", desc: "Direct, coup de poing." },
        dense: { label: "Dense", desc: "Factuel, riche, no-fluff." },
        pedagogique: { label: "Pédagogique", desc: "Clair, progressif, explicatif." },
        minimal: { label: "Minimal", desc: "Court, essentiel, bullet points." }
      };
      return [
        { id: "ouf", ...l.ouf },
        { id: "punchy", ...l.punchy },
        { id: "dense", ...l.dense },
        { id: "pedagogique", ...l.pedagogique },
        { id: "minimal", ...l.minimal }
      ];
    }

    const RECENT_KEY = "codebase-recent-projects";
    const CUSTOM_PRESETS_KEY = "codebase-custom-presets";

    function getFocusSuggestions(locale) {
      if (locale === "en") {
        return {
          intel: ["architecture", "technical debt", "key engines", "opportunities"],
          report: ["SWOT", "90-day roadmap", "scorecard", "risks"],
          audit: ["TODO", "console.log", "any", "missing tests"],
          tasks: ["quick-wins", "sprint 1", "prioritization", "Before/After"],
          player: ["onboarding", "frictions", "wow moments", "journey"]
        };
      }
      return {
        intel: ["architecture", "dette technique", "moteurs cles", "opportunites"],
        report: ["SWOT", "roadmap 90j", "score card", "risques"],
        audit: ["TODO", "console.log", "any", "tests manquants"],
        tasks: ["quick-wins", "sprint 1", "priorisation", "Avant/Après"],
        player: ["onboarding", "frictions", "wow moments", "parcours"]
      };
    }

    function getPresets(locale) {
      if (locale === "en") {
        return [
          { id: "investor", label: "Investor", mode: "report", style: "punchy", focus: "Risk, opportunities and ROI summary for a board." },
          { id: "techlead", label: "Tech Lead", mode: "intel", style: "dense", focus: "Architecture, technical debt, engine decisions and 90-day roadmap." },
          { id: "recruit", label: "New Hire", mode: "intel", style: "pedagogique", focus: "Project overview, stack and how to get oriented quickly." },
          { id: "delivery", label: "Delivery", mode: "tasks", style: "dense", focus: "Prioritized TASKS.md with quick-wins and realistic sprints." }
        ];
      }
      return [
        { id: "investor", label: "Investisseur", mode: "report", style: "punchy", focus: "Synthese risques, opportunites et ROI a destination d'un board." },
        { id: "techlead", label: "Tech Lead", mode: "intel", style: "dense", focus: "Architecture, dette technique, decisions moteur et roadmap 90 jours." },
        { id: "recruit", label: "Recrue", mode: "intel", style: "pedagogique", focus: "Vue d'ensemble du projet, stack et comment s'y retrouver rapidement." },
        { id: "delivery", label: "Delivery", mode: "tasks", style: "dense", focus: "TASKS.md priorise avec quick-wins et sprints realistes." }
      ];
    }

    function getProTips(locale) {
      if (locale === "en") {
        return [
          "Focus sharpens the brief: mention a file, an engine, or a UI.",
          "Styles change the tone without changing the quality.",
          "An absolute path without quotes works if spaces are escaped.",
          "The preview appears after 400 ms of pause in the project field."
        ];
      }
      return [
        "Le focus affine le brief : mentionne un fichier, un moteur ou une UI.",
        "Les styles modifient le ton sans changer la qualite.",
        "Un chemin absolu sans guillemets fonctionne si les espaces sont protégées.",
        "L'apercu apparait apres 400 ms de pause dans le champ projet."
      ];
    }

    const MODE_ALIASES = {
      report: "report",
      rapport: "report",
      intel: "intel",
      intelligence: "intel",
      inteligence: "intel",
      audit: "audit",
      tasks: "tasks",
      task: "tasks",
      taches: "tasks",
      tache: "tasks",
      player: "player",
      playthrough: "player",
      ux: "player"
    };

    function showToast(message, type = "info") {
      const existing = document.getElementById("codebase-chat-toast");
      if (existing) existing.remove();
      const toast = document.createElement("div");
      toast.id = "codebase-chat-toast";
      toast.textContent = message;
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        padding: "12px 16px",
        borderRadius: "10px",
        fontSize: "13px",
        fontWeight: 500,
        color: "#fff",
        background: type === "error" ? palette.danger : palette.bg,
        border: `1px solid ${palette.border}`,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 999999,
        maxWidth: "320px",
        lineHeight: 1.4,
        transition: "opacity 0.3s ease"
      });
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    function LoadingOverlay({ mode, projectPath, progress, locale }) {
      const labels = getLabels(locale);
      const modeLabel = getModes(locale).find((m) => m.id === mode)?.title || labels.loadingTitle;
      const shortPath = projectPath?.length > 55 ? `...${projectPath.slice(-55)}` : (projectPath || "auto");
      const css = `@keyframes codebase-spin { to { transform: rotate(360deg); } }`;
      const visible = progress.slice(-4);
      const pct = progress.length ? Math.min(100, Math.max(8, progress.length * 10)) : 8;
      return jsxs(React.Fragment, {
        children: [
          jsx("style", { dangerouslySetInnerHTML: { __html: css }, key: "spin-css" }),
          jsxs("div", {
            key: "overlay-backdrop",
            style: styles.overlay,
            children: [
              jsxs("div", {
                style: styles.overlayCard,
                children: [
                  jsxs("div", {
                    style: styles.spinnerWrap,
                    children: [
                      jsx("svg", {
                        width: "48",
                        height: "48",
                        viewBox: "0 0 48 48",
                        children: [
                          jsx("circle", {
                            cx: "24",
                            cy: "24",
                            r: "20",
                            fill: "none",
                            stroke: "rgba(255,255,255,0.08)",
                            strokeWidth: "4"
                          }),
                          jsx("circle", {
                            cx: "24",
                            cy: "24",
                            r: "20",
                            fill: "none",
                            stroke: palette.accent,
                            strokeWidth: "4",
                            strokeLinecap: "round",
                            strokeDasharray: "78 125",
                            style: {
                              transformOrigin: "24px 24px",
                              animation: "codebase-spin 1.1s linear infinite"
                            }
                          })
                        ]
                      })
                    ]
                  }),
                  jsx("div", { style: styles.overlayTitle, children: labels.loadingTitle, key: "title" }),
                  jsxs("div", { style: styles.overlaySubtitle, children: [modeLabel, " ", jsx("span", { style: { opacity: .65 }, children: `• ${shortPath}` })], key: "sub" }),
                  jsxs("div", { style: styles.progressTrack, children: [jsx("div", { style: styles.progressFill(pct) })] }),
                  jsxs("div", {
                    style: styles.progressList,
                    children: visible.map((msg, i) => jsxs("div", {
                      key: i,
                      style: styles.progressItem(i === visible.length - 1),
                      children: [
                        jsx("span", { style: { display: "inline-flex", alignItems: "center" }, children: i === visible.length - 1 ? jsx(DotIcon, { style: { width: 8, height: 8 } }) : jsx(CheckIcon, { style: { width: 8, height: 8 } }) }),
                        msg
                      ]
                    }))
                  })
                ]
              })
            ]
          })
        ]
      });
    }

    function SuccessOverlay({ mode, projectPath, onClose, locale }) {
      const labels = getLabels(locale);
      const modeLabel = getModes(locale).find((m) => m.id === mode)?.title || labels.loadingTitle;
      const shortPath = projectPath?.length > 55 ? `...${projectPath.slice(-55)}` : (projectPath || labels.autoDetect || "auto");
      const [remaining, setRemaining] = React.useState(100);
      const duration = 3500;
      const start = React.useRef(Date.now());

      React.useEffect(() => {
        const id = setInterval(() => {
          const pct = Math.max(0, 100 - ((Date.now() - start.current) / duration) * 100);
          setRemaining(pct);
          if (pct <= 0) onClose();
        }, 80);
        const timeout = setTimeout(onClose, duration);
        return () => { clearInterval(id); clearTimeout(timeout); };
      }, [onClose]);

      return jsxs("div", {
        style: styles.overlay,
        children: [
          jsxs("div", {
            style: { ...styles.overlayCard, border: "1px solid rgba(16, 185, 129, 0.22)", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45), 0 0 40px rgba(16, 185, 129, 0.10)" },
            children: [
              jsxs("div", {
                style: styles.successIcon,
                children: [
                  jsxs("svg", {
                    width: "32",
                    height: "32",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "#34d399",
                    strokeWidth: "2.5",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    children: [
                      jsx("polyline", { points: "20 6 9 17 4 12" })
                    ]
                  })
                ]
              }),
              jsx("div", { style: styles.successTitle, children: labels.successTitle }),
              jsxs("div", { style: styles.successSubtitle, children: [labels.successBody, jsx("span", { style: { color: "#d1d5db" }, children: ` — ${shortPath}` })] }),
              jsxs("button", {
                type: "button",
                style: styles.successButton,
                onClick: onClose,
                children: [labels.close, jsx("span", { children: " →" })]
              }),
              jsxs("div", { style: styles.successTrack, children: [jsx("div", { style: styles.successFill(remaining) })] })
            ]
          })
        ]
      });
    }

    function useLocalStorage(key, initial) {
      const [value, setValue] = React.useState(() => {
        try { return JSON.parse(window.localStorage?.getItem(key)) || initial; } catch { return initial; }
      });
      const save = React.useCallback((next) => {
        setValue(next);
        try { window.localStorage?.setItem(key, JSON.stringify(next)); } catch {}
      }, [key]);
      return [value, save];
    }

    function MenuModal({ sessionId, onClose }) {
      const savedPath = (() => {
        try { return window.localStorage?.getItem("codebase-project-path") || ""; } catch { return ""; }
      })();
      const [locale, setLocale] = useLocalStorage(LOCALE_KEY, "fr");
      const labels = getLabels(locale);
      const MODES = getModes(locale);
      const STYLE_OPTIONS = getStyleOptions(locale);
      const FOCUS_SUGGESTIONS = getFocusSuggestions(locale);
      const PRESETS = getPresets(locale);
      const PRO_TIPS = getProTips(locale);

      const [projectPath, setProjectPath] = React.useState(savedPath);
      const [mode, setMode] = React.useState("intel");
      const [style, setStyle] = React.useState("ouf");
      const [focus, setFocus] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [progress, setProgress] = React.useState([]);
      const [success, setSuccess] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [preview, setPreview] = React.useState(null);
      const [previewLoading, setPreviewLoading] = React.useState(false);
      const [recent, setRecent] = useLocalStorage(RECENT_KEY, []);
      const [customPresets, setCustomPresets] = useLocalStorage(CUSTOM_PRESETS_KEY, []);
      const modalRef = React.useRef(null);

      React.useEffect(() => {
        modalRef.current?.focus();
      }, []);

      const modeInfo = MODES.find((m) => m.id === mode);
      const styleInfo = STYLE_OPTIONS.find((s) => s.id === style);

      React.useEffect(() => {
        if (!projectPath.trim()) {
          setPreview(null);
          return;
        }
        const id = setTimeout(() => {
          setPreviewLoading(true);
          fetch("/codebase-chat/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectPath: projectPath.trim() })
          })
            .then((r) => r.json().catch(() => ({})))
            .then((data) => {
              if (data.ok) setPreview(data);
              else setPreview(null);
            })
            .catch(() => setPreview(null))
            .finally(() => setPreviewLoading(false));
        }, 400);
        return () => clearTimeout(id);
      }, [projectPath]);

      const handleSubmit = React.useCallback(async () => {
        if (busy || !sessionId) return;
        if (!modeInfo) return;

        const cleanPath = projectPath.trim();
        if (cleanPath) {
          try { window.localStorage?.setItem("codebase-project-path", cleanPath); } catch {}
        }

        const nextRecent = [{ path: cleanPath || labels.autoDetect, mode, date: Date.now() }, ...recent.filter((r) => r.path !== (cleanPath || labels.autoDetect))].slice(0, 5);
        setRecent(nextRecent);

        const defaultQueries = locale === "en" ? {
          report: focus.trim() || "Complete Strategic Report",
          intel: focus.trim() || "Complete Pro Intelligence Brief",
          audit: focus.trim() || "Complete non-conformities audit",
          tasks: focus.trim() || "Generate the TASKS.md",
          player: focus.trim() || "Player brief / user journey"
        } : {
          report: focus.trim() || "Rapport Stratégique complet",
          intel: focus.trim() || "Brief d'Intelligence Pro complet",
          audit: focus.trim() || "Audit non-conformités complet",
          tasks: focus.trim() || "Génère le TASKS.md",
          player: focus.trim() || "Player brief / parcours utilisateur"
        };
        const creaThemes = locale === "en" ? "generated with passion by shinzarou-eng" : "généré avec passion par shinzarou-eng";

        setBusy(true);
        setProgress([]);
        setError(null);

        const poll = () => {
          fetch(`/codebase-chat/progress?sessionId=${encodeURIComponent(sessionId)}`)
            .then((r) => r.json().catch(() => ({})))
            .then((data) => {
              if (data?.messages) setProgress(data.messages);
            })
            .catch(() => {});
        };
        poll();
        const pollId = setInterval(poll, 250);

        const startAt = Date.now();
        let successInfo = null;
        try {
          const response = await fetch("/codebase-chat/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              projectPath: cleanPath || undefined,
              mode,
              query: defaultQueries[mode],
              style,
              lang: locale,
              crea: true,
              creaTheme: creaThemes
            })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(body.error || `Erreur ${response.status}`);
          }
          successInfo = { mode, projectPath: cleanPath || labels.autoDetect };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          showToast(`${labels.error} : ${msg}`, "error");
        } finally {
          clearInterval(pollId);
          const elapsed = Date.now() - startAt;
          if (elapsed < 1500) await new Promise((r) => setTimeout(r, 1500 - elapsed));
          setBusy(false);
          setProgress([]);
          if (successInfo) {
            setSuccess(successInfo);
          }
        }
      }, [busy, sessionId, projectPath, mode, focus, modeInfo, style, recent, setRecent]);

      const loadRecent = (r) => {
        setProjectPath(r.path === "auto-détection" ? "" : r.path);
        if (r.mode) setMode(r.mode);
      };

      if (success) {
        return jsx(SuccessOverlay, { mode: success.mode, projectPath: success.projectPath, onClose: () => { onClose(); setSuccess(null); }, locale });
      }

      if (busy) {
        return jsx(LoadingOverlay, { mode, projectPath: projectPath.trim() || labels.autoDetect, progress, locale });
      }

      const topRecent = recent.slice(0, 4);

      return jsxs("div", {
        ref: modalRef,
        tabIndex: -1,
        style: styles.backdrop,
        onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
        onKeyDown: (e) => {
          if (e.key === "Escape") { onClose(); return; }
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy) { e.preventDefault(); handleSubmit(); }
        },
        children: [
          jsxs("div", {
            style: styles.modal,
            children: [
              jsxs("div", {
                style: styles.modalHeader,
                children: [
                  jsxs("div", { style: styles.modalTitle, children: [jsx(CodebaseLogo, { style: { width: 22, height: 22 } }), labels.title, jsx("span", { style: styles.badge, children: labels.badge })] }),
                  jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
                    jsxs("select", {
                      value: locale,
                      onChange: (e) => setLocale(e.target.value),
                      style: styles.langSelect,
                      children: [
                        jsx("option", { value: "fr", children: "FR" }),
                        jsx("option", { value: "en", children: "EN" })
                      ]
                    }),
                    jsx("button", { style: styles.modalClose, onClick: onClose, children: jsx(CloseIcon, { style: { width: 14, height: 14 } }) })
                  ]})
                ]
              }),

              topRecent.length ? jsxs("div", { style: styles.section, children: [
                jsx("div", { style: styles.sectionTitle, children: labels.recent }),
                jsxs("div", { style: styles.recentList, children: topRecent.map((r, i) => jsxs("div", {
                  style: styles.recentItem,
                  onClick: () => loadRecent(r),
                  children: [
                    jsx("span", { style: styles.recentPath, children: r.path }),
                    jsxs("span", { style: styles.recentMeta, children: [MODES.find((m) => m.id === r.mode)?.title || r.mode, " • ", new Date(r.date).toLocaleDateString()] })
                  ]
                }, i)) })
              ]}) : null,

              jsxs("div", { style: styles.section, children: [
                jsxs("div", { style: { ...styles.sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
                  labels.presets,
                  jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
                    jsx("button", {
                      type: "button",
                      style: styles.ghost,
                      onClick: () => {
                        const label = window.prompt(labels.addPreset);
                        if (!label || !focus.trim()) return;
                        setCustomPresets([...customPresets, { id: `custom-${Date.now()}`, label, mode, style, focus }].slice(-8));
                      },
                      title: labels.savePreset,
                      children: "+"
                    }),
                    jsx("span", { style: { fontSize: 10, color: palette.muted, fontWeight: 400 }, children: labels.presetsHint })
                  ]})
                ]}),
                jsxs("div", { style: styles.chipRow, children: [...PRESETS, ...customPresets].map((p) => jsxs("button", {
                  type: "button",
                  style: styles.chip(false),
                  onClick: () => { setMode(p.mode); setStyle(p.style); setFocus(p.focus); },
                  title: `${p.label} : ${p.focus}`,
                  children: p.label
                }, p.id)) })
              ]}),

              jsxs("div", { style: styles.section, children: [
                jsx("div", { style: styles.sectionTitle, children: labels.project }),
                jsx("input", {
                  type: "text",
                  style: styles.input,
                  value: projectPath,
                  placeholder: labels.projectPlaceholder,
                  onChange: (e) => setProjectPath(e.target.value)
                }),
                preview && !previewLoading ? jsxs("div", { style: styles.previewCard, children: [
                  jsx("strong", { children: preview.name || labels.project }),
                  " ",
                  jsx("span", { style: styles.previewStats, children: `(${preview.summary?.name || preview.path}) · ${preview.files || 0} ${locale === "en" ? "files" : "fichiers"} · ${preview.sourceLines?.toLocaleString() || 0} ${locale === "en" ? "lines" : "lignes"} · ${preview.testFiles || 0} ${locale === "en" ? "tests" : "tests"}` })
                ]}) : previewLoading ? jsxs("div", { style: { ...styles.previewCard, textAlign: "center" }, children: [jsx("div", { style: { fontSize: 11, color: palette.muted }, children: labels.previewLoading })] }) : null
              ]}),

              jsxs("div", { style: styles.section, children: [
                jsx("div", { style: styles.sectionTitle, children: labels.mode }),
                jsxs("div", { style: styles.grid, children: MODES.map((m) => jsxs("button", {
                  type: "button",
                  style: styles.modeCard(mode === m.id),
                  onClick: () => setMode(m.id),
                  children: [
                    mode === m.id ? jsx("div", { style: styles.check, children: jsx(CheckIcon, { style: { width: 10, height: 10 } }) }) : null,
                    jsx(ModeIcon, { mode: m.id, style: styles.modeIcon }),
                    jsx("div", { style: styles.modeTitle, children: m.title }),
                    jsx("div", { style: styles.modeDesc, children: m.desc })
                  ]
                }, m.id)) })
              ]}),

              jsxs("div", { style: styles.section, children: [
                jsx("div", { style: styles.sectionTitle, children: labels.style }),
                jsxs("div", { style: styles.chipRow, children: STYLE_OPTIONS.map((s) => jsxs("button", {
                  type: "button",
                  style: styles.chip(style === s.id),
                  onClick: () => setStyle(s.id),
                  title: s.desc,
                  children: s.label
                }, s.id)) })
              ]}),

              jsxs("div", { style: styles.section, children: [
                jsx("div", { style: styles.sectionTitle, children: labels.focus }),
                jsx("textarea", {
                  style: styles.textarea,
                  value: focus,
                  placeholder: labels.focusPlaceholder,
                  onChange: (e) => setFocus(e.target.value)
                }),
                jsxs("div", { style: { ...styles.chipRow, marginTop: "6px" }, children: (FOCUS_SUGGESTIONS[mode] || []).map((tag) => jsx("button", {
                  type: "button",
                  style: styles.miniChip,
                  onClick: () => setFocus((prev) => prev ? `${prev}, ${tag}` : tag),
                  children: tag
                }, tag)) })
              ]}),

              jsxs("div", { style: styles.footer, children: [
                jsx("button", { type: "button", style: styles.cancelButton, onClick: onClose, children: labels.cancel }),
                jsxs("button", {
                  type: "button",
                  style: styles.runButton(!sessionId || !modeInfo),
                  disabled: !sessionId || !modeInfo,
                  onClick: handleSubmit,
                  children: [jsx(SparklesIcon, { style: { width: 14, height: 14 } }), labels.run]
                })
              ]}),

              jsx("div", { style: styles.microFooter, children: jsx("span", { style: { color: palette.muted }, children: labels.footer }) })
            ]
          })
        ]
      });
    }

    function CodebaseButton(props) {
      const { wide, useSessions } = props;
      const sessionState = useSessions((state) => state);
      const sessionId = sessionState?.current;
      const [open, setOpen] = React.useState(false);
      const [locale] = useLocalStorage(LOCALE_KEY, "fr");
      const labels = getLabels(locale);

      const disabled = !sessionId;
      const title = sessionId ? labels.actionTitle : labels.sessionRequired;

      const buttonStyle = disabled
        ? { ...styles.button, ...styles.buttonDisabled }
        : styles.button;

      return jsxs(React.Fragment, {
        children: [
          jsxs("button", {
            type: "button",
            style: buttonStyle,
            disabled,
            title,
            "aria-label": "Codebase Pro",
            onClick: () => setOpen(true),
            children: [
              jsx(CodebaseLogo, { style: styles.icon, key: "icon" }),
              wide ? jsx("span", { style: styles.label, children: "Codebase Pro", key: "label" }) : null
            ]
          }),
          open && sessionId ? jsx(MenuModal, { sessionId, onClose: () => setOpen(false) }) : null
        ]
      });
    }

    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", () => {
        return ctx.slots.register({
          name: "sidebar.footer.action",
          id: "codebase-chat-button",
          order: 60
        }, CodebaseButton);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
