import { Client } from "@notionhq/client";

export const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});

export interface NotionDatabase {
    id: string;
    name: string;
    dataSourceId?: string;
    propNames: {
        title: string;
        status: string;
        date: string;
    };
    propTypes: {
        status: "status" | "select";
    };
}

// Discover all databases shared with the integration that have the required types (title, status, date)
export async function discoverDatabases(): Promise<NotionDatabase[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await notion.search({});

    const validDatabases: NotionDatabase[] = [];

    for (const db of response.results) {
        const type = db.object;
        const id = db.id;

        let dbName = "";

        // 1. Try to get title from standard database title array
        if ((db as any).title && Array.isArray((db as any).title) && (db as any).title.length > 0) {
            dbName = (db as any).title.map((t: any) => t.plain_text).join("");
        }

        // 2. Fallback for data_source objects which might just have a .name property
        if (!dbName && (db as any).name) {
            dbName = (db as any).name;
        }

        // 3. Fallback for properties inside data_source (if search doesn't extract it)
        if (!dbName) {
            dbName = "Untitled " + (type === "database" ? "Database" : "Data Source");
        }

        // console.log(`[Discovery] Found ${type}: "${dbName}" (${id})`);

        if (type === "data_source" || type === "database") {
            try {
                const fullObj: any = type === "data_source"
                    ? await (notion as any).dataSources.retrieve({ data_source_id: id })
                    : await notion.databases.retrieve({ database_id: id });

                const props = fullObj.properties || {};
                let titleName = "";
                let statusName = "";
                let statusType: "status" | "select" = "status";
                let dateName = "";

                const propTypes = Object.entries(props).map(([n, p]: [string, any]) => `${n}:${p.type}`);

                for (const [name, prop] of Object.entries(props)) {
                    const p = prop as any;
                    if (p.type === "title") titleName = name;
                    // Broad mapping: allow 'status' or 'select' for the status logic
                    if (p.type === "status" || p.type === "select") {
                        statusName = name;
                        statusType = p.type as "status" | "select";
                    }
                    if (p.type === "date") dateName = name;
                }

                if (titleName && statusName && dateName) {
                    validDatabases.push({
                        id,
                        name: dbName,
                        dataSourceId: type === "data_source" ? id : undefined,
                        propNames: { title: titleName, status: statusName, date: dateName },
                        propTypes: { status: statusType }
                    });
                } else {
                    const missing = [];
                    if (!titleName) missing.push("Title property");
                    if (!statusName) missing.push("Status/Select property");
                    if (!dateName) missing.push("Date property");
                }
            } catch (err) {
                console.error(`[Discovery]   ❌ Error retrieving details for ${dbName}:`, err);
            }
        }
    }

    return validDatabases;
}

// Fetch raw tasks using either data_source_id (if exists) or standard database_id
export async function getRawNotionTasks(databaseId: string, dataSourceId?: string) {
    const notionAny = notion as any;
    if (dataSourceId) {
        const response = await notionAny.dataSources.query({
            data_source_id: dataSourceId,
        });
        return response.results;
    } else {
        const response = await notionAny.databases.query({
            database_id: databaseId,
        });
        return response.results;
    }
}
