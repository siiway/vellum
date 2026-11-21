// The notice on a page the reader's locale has no translation of, which
// shows another locale's page instead (PageMeta.fallbackLocale). It has the
// reader's `lang`, as the content around it has that page's.

import { MessageBar, MessageBarBody, tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { format } from "../../shared/i18n";
import { canonicalLocaleCode } from "../../shared/types";

const useStyles = makeStyles({
  notice: {
    marginBottom: tokens.spacingVerticalXL,
  },
});

export function FallbackNotice() {
  const styles = useStyles();
  const { data, t } = useVellum();
  const { locales } = data.config.site;
  const source = locales.find((l) => l.code === data.page.meta.fallbackLocale);
  const current = locales.find((l) => l.code === data.route.localeCode);
  if (!source || !current) return null;
  return (
    <MessageBar
      intent="info"
      layout="multiline"
      lang={canonicalLocaleCode(current.code)}
      className={styles.notice}
    >
      <MessageBarBody>
        {format(t("ui.fallback"), { locale: current.label, source: source.label })}
      </MessageBarBody>
    </MessageBar>
  );
}
