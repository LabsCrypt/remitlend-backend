import swaggerJSDoc from "swagger-jsdoc";
import path from "path";

const swaggerDefinition = {
    openapi: "3.0.0",
    info: {
        title: "RemitLend API",
        version: "1.0.0",
        description: "API documentation for RemitLend backend",
    },
    servers: [
        {
            url: "http://localhost:3001/api",
            description: "Development server",
        },
    ],
};


const options: swaggerJSDoc.Options = {
    swaggerDefinition,
    apis: [path.resolve(__dirname, "../routes/*.ts")],
};

export const swaggerSpec = swaggerJSDoc(options);
