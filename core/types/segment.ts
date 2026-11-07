export interface MediaRef {
    uri: string;
    localPath?: string;
    mime?: string;
    size?: number;
    raw?: Record<string, unknown>;
}


export interface MsgSegment {
    text: { text: string };
    image: { media: MediaRef; alt?: string };
    file: { media: MediaRef; name?: string };
    mention: { id: string; name?: string; isSelf?: boolean };
    reply: { id: string; excerpt?: string };
    link_card: { title: string; url?: string; description?: string };
}

