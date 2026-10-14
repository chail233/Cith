import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";

export default class OnebotAdapter extends BaseAdapter{
    private ws: any;
    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>, ws: any) {
        super(pipeline);
        this.ws = ws;
    }

    sendAction(actionObj: Action) {
        const payload = JSON.stringify(actionObj);
        logger.debug("发送动作:", actionObj.action);
        this.ws.send(payload);
    }

    sendMsg(space:Space, message:object[]|object|string) {
        this.sendAction({
            action: "send_msg",
            params: {
                message_type: space.from==="group" ? "group" : "private",
                group_id: space.from==="group"? space.id : null,
                user_id: space.from==="user"?space.id : null,
                message
            },
        });
    }
}

interface Action{
    action: string;
    params?: any;
    echo?: string;
}