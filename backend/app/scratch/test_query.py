import asyncio
import json
from app.config import get_settings
from app.database import get_pool

import os

def import_dotenv(path, aliases=None):
    if aliases is None:
        aliases = {}
    if not os.path.exists(path):
        print(f"Path not found: {path}")
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if "=" not in line or line.startswith("#"):
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            value = value.strip().strip('"').strip("'")
            target = aliases.get(name, name)
            if not os.environ.get(target):
                os.environ[target] = value

async def main():
    import_dotenv(r"D:\BD_LOCAL\api-fastapi\.env", {"SUPABASE_JWT_SECRET": "AUTH_JWT_SECRET"})
    import_dotenv(r"D:\Sedapal\apps\web\.env", {
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": "SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_URL": "SUPABASE_URL",
        "FASTAPI_LOCAL_API_KEY": "EXTERNAL_REPORTS_API_KEY"
    })
    
    # Algunas variables adicionales requeridas que el script de PS infiere o no
    if "AUTH_JWT_SECRET" not in os.environ:
        os.environ["AUTH_JWT_SECRET"] = "some_secret_key_here"
        
    settings = get_settings()
    print("Database URL:", settings.database_url)
    
    # Nos conectamos a la BD usando la función de base de datos de la app
    from app.database import open_pool, close_pool, get_pool
    await open_pool()
    pool = get_pool()
    
    supply_code = "5198514"
    
    from app.repositories.reportes import fetch_supply_indicators
    
    try:
        report = await fetch_supply_indicators(pool, supply_code)
        print("REPORT RETRIEVED SUCCESSFULLY!")
        spatial = report.get("spatial", {})
        print("Spatial keys:", list(spatial.keys()))
        print("blockCode:", spatial.get("blockCode"))
        print("blockLots count:", len(spatial.get("blockLots", [])))
        print("lotSupplies:", json.dumps(spatial.get("lotSupplies"), indent=2))
        print("blockSupplies count:", len(spatial.get("blockSupplies", [])) if spatial.get("blockSupplies") else "None")
        print("blockSupplies:", json.dumps(spatial.get("blockSupplies"), indent=2))
    except Exception as e:
        print("Error running fetch_supply_indicators:", e)
        import traceback
        traceback.print_exc()
        
    await close_pool()

if __name__ == "__main__":
    asyncio.run(main())
