-- Reports remain private unless a separately reviewed workflow grants publication.
ALTER TABLE issues ADD COLUMN public_sharing INTEGER NOT NULL DEFAULT 0 CHECK(public_sharing IN (0,1));
