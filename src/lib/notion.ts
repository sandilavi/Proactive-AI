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

    const databasePromises = response.results.map(async (db: any) => {
        const type = db.object;
        const id = db.id;

        let dbName = "";

        // 1. Try to get title from standard database title array
        if (db.title && Array.isArray(db.title) && db.title.length > 0) {
            dbName = db.title.map((t: any) => t.plain_text).join("");
        }

        // 2. Fallback for data_source objects which might just have a .name property
        if (!dbName && db.name) {
            dbName = db.name;
        }

        // 3. Fallback for properties inside data_source (if search doesn't extract it)
        if (!dbName) {
            dbName = "Untitled " + (type === "database" ? "Database" : "Data Source");
        }

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
                    return {
                        id,
                        name: dbName,
                        dataSourceId: type === "data_source" ? id : undefined,
                        propNames: { title: titleName, status: statusName, date: dateName },
                        propTypes: { status: statusType }
                    };
                }
            } catch (err) {
                console.error(`[Discovery]   ❌ Error retrieving details for ${dbName}:`, err);
            }
        }
        return null;
    });

    const results = await Promise.all(databasePromises);
    return results.filter((db): db is NotionDatabase => db !== null);
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
