
import { FastifyInstance } from 'fastify';

export interface AssetParams {
  assetId: string;
}

// Extend FastifyInstance to include db
interface FastifyInstanceWithDb extends FastifyInstance {
  db: {
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

export async function registerRoiRiskRoutes(app: FastifyInstance) {
  const appWithDb = app as FastifyInstanceWithDb;
  
  app.get('/roi-risk/:assetId', async (req) => {
  const { assetId } = req.params as AssetParams;
  const res = await appWithDb.db.query(
    'select * from roi_with_risk where asset_id = $1',
    [assetId]
  );
  return res.rows[0];
  });
}
