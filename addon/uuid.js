export default class UUID {
    static numeric() {
        let uuid;

        // crypto.randomUUID is available only in secure contexts, e.g., it is absent
        // in the notes iframe embedded into an archive served over plain http
        if (crypto.randomUUID)
            uuid = crypto.randomUUID().replaceAll(/-/g, "");
        else {
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
            bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
            uuid = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
        }

        return uuid.toUpperCase();
    }

    static date(dt = new Date()) {
        return dt.getFullYear()
            + ("0" + (dt.getMonth() + 1)).slice(-2)
            + ("0" + dt.getDate()).slice(-2)
            + ("0" + dt.getHours()).slice(-2)
            + ("0" + dt.getMinutes()).slice(-2)
            + ("0" + dt.getSeconds()).slice(-2);
    };

    static getDate(uuid) {
        const dt = new Date();
        const y = uuid.substring(0, 4);
        const m = uuid.substring(4, 6);
        const d = uuid.substring(6, 8);
        const h = uuid.substring(8, 10);
        const mi = uuid.substring(10, 12);
        const s = uuid.substring(12, 14);

        dt.setFullYear(y);
        dt.setMonth(parseInt(m) - 1);
        dt.setDate(d);
        dt.setHours(h);
        dt.setMinutes(mi);
        dt.setSeconds(s);

        return dt;
    };
};
