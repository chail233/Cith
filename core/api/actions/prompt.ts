/**
 * prompt action：系统提示词读取与保存
 *
 * 提示词存于 core/prompts/system.md，保存后下一回合生效（无需重启）。
 */
import { getPromptDoc, saveSystemPrompt } from "../../services/prompt-store.ts";
import { registerAction } from "../router.ts";

registerAction("get_prompt", () => getPromptDoc());

registerAction("set_prompt", (params) => saveSystemPrompt(params?.text));
