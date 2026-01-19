import { Client } from "@notionhq/client";

export const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});
    
export async function fetchNotionTasks() {
    // First, retrieve the database to get its data_source_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const database: any = await notion.databases.retrieve({
        database_id: process.env.NOTION_DATABASE_ID!,
    });

    const dataSource = database.data_sources?.[0];
    if (!dataSource) {
        throw new Error("No data_sources found for the configured Notion database.");
    }

    // Then query using the data_source_id
    const response = await notion.dataSources.query({
        data_source_id: dataSource.id,
    });
    return response.results;
}
