import type Request from "@/lib/request/Request.ts";
import { getLiveModels } from "@/api/controllers/models.ts";

export default {

    prefix: '/v1',

    get: {
        '/models': async (request: Request) => {
            const result = await getLiveModels(request.headers.authorization);
            return {
                source: result.source,
                data: result.data
            };
        }

    }
}