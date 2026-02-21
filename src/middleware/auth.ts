import type { Request, Response, NextFunction } from 'express';

/**
 * Middleware that enforces API-key access control.
 *
 * Callers must provide the `x-api-key` header whose value matches the
 * `INTERNAL_API_KEY` environment variable.  This gate is applied to
 * mutating score endpoints so that only trusted services (e.g. LoanManager
 * off-chain workers) can update credit scores.
 */
export const requireApiKey = (req: Request, res: Response, next: NextFunction): void => {
    const providedKey = req.headers['x-api-key'];
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (!expectedKey) {
        res.status(500).json({
            success: false,
            message: 'Server misconfiguration: INTERNAL_API_KEY is not set'
        });
        return;
    }

    if (!providedKey || providedKey !== expectedKey) {
        res.status(401).json({
            success: false,
            message: 'Unauthorised: invalid or missing API key'
        });
        return;
    }

    next();
};
