create table subprimal_prices (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  session text not null check (session in ('AM', 'PM')),
  grade text not null check (grade in ('Choice', 'Select', 'Choice and Select')),
  item_description text not null,
  number_trades integer,
  total_pounds numeric,
  price_range_low numeric,
  price_range_high numeric,
  weighted_average numeric,
  source_hash text,
  created_at timestamptz default now(),
  constraint subprimal_prices_date_session_grade_item_description_key
    unique (date, session, grade, item_description)
);

create index subprimal_prices_date_session_idx
  on subprimal_prices (date, session);

create index subprimal_prices_item_description_idx
  on subprimal_prices (item_description);
