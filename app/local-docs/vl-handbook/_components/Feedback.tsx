import { useState } from "react";
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { usePage } from "vellum";

const useStyles = makeStyles({
  surface: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  answers: { display: "flex", gap: tokens.spacingHorizontalS },
});

export default function Feedback() {
  const { lang } = usePage();
  const zh = lang === "zh";
  const styles = useStyles();
  const [answered, setAnswered] = useState(false);
  return (
    <Popover withArrow>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip
          content={zh ? "告诉我们这一页写得怎么样" : "Tell us how this page did"}
          relationship="description"
        >
          <Button appearance="primary">{zh ? "这一页有帮助吗？" : "Was this page helpful?"}</Button>
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className={styles.surface}>
        {answered ? (
          zh ? "谢谢！" : "Thanks!"
        ) : (
          <div className={styles.answers}>
            <Button onClick={() => setAnswered(true)}>{zh ? "有帮助" : "Yes"}</Button>
            <Button onClick={() => setAnswered(true)}>{zh ? "没有" : "No"}</Button>
          </div>
        )}
      </PopoverSurface>
    </Popover>
  );
}
