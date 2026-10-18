-- Seed catalogue + a starting rundown so the site has something to show on day one.
insert into songs (title, artist) values
 ('Ordinary','Alex Warren'),
 ('Touch','KATSEYE'),
 ('Anxiety','Doechii'),
 ('APT.','ROSÉ & Bruno Mars'),
 ('Abracadabra','Lady Gaga'),
 ('luther','Kendrick Lamar & SZA'),
 ('New Woman','LISA & Rosalía'),
 ('That''s So True','Gracie Abrams'),
 ('BIRDS OF A FEATHER','Billie Eilish'),
 ('Beautiful Things','Benson Boone'),
 ('Espresso','Sabrina Carpenter'),
 ('Good Luck, Babe!','Chappell Roan'),
 ('Timeless','The Weeknd'),
 ('Lose Control','Teddy Swims'),
 ('A Bar Song (Tipsy)','Shaboozey'),
 ('360','Charli xcx'),
 ('we can''t be friends','Ariana Grande'),
 ('Water','Tyla'),
 ('Too Sweet','Hozier'),
 ('Houdini','Dua Lipa')
on conflict do nothing;

-- A starting rundown for today's show.
insert into rundown (show_date, position, song_id, requested_by, hour_label, status)
select current_date, n.pos, s.id, n.who, n.hr, case when n.pos = 1 then 'playing' else 'queued' end
from (values
  (1,'Ordinary','Priya, Houston TX','Hour 1'),
  (2,'Touch','Maya, Manila PH','Hour 1'),
  (3,'Anxiety','Devon, Toronto ON','Hour 1'),
  (4,'APT.','Camila, Bogotá CO','Hour 1'),
  (5,'Abracadabra','Theo, Dublin IE','Hour 2'),
  (6,'New Woman','Nari, Vancouver BC','Hour 2'),
  (7,'luther','Andre, Chicago IL','Hour 2'),
  (8,'360','Fin, Manchester UK','Hour 2'),
  (9,'Houdini','Sofia, Milan IT','Hour 3')
) as n(pos,title,who,hr)
join songs s on s.title = n.title
on conflict do nothing;

-- Seed requests so the chart isn't empty on first load, with a realistic
-- falling distribution rather than a flat one. Spread over the last 6 days.
insert into requests (song_id, raw_text, name, city, source, created_at)
select s.id,
       s.title || ' — ' || s.artist,
       (array['Maya','Devon','Lucía','Jayden','Nari','Theo','Priya','Kai','Camila','Min-seo'])[1 + floor(random()*10)::int],
       (array['Manila, PH','Toronto, ON','Madrid, ES','Atlanta, GA','Seoul, KR','London, UK','São Paulo, BR','Sydney, AU','Chicago, IL','Dublin, IE'])[1 + floor(random()*10)::int],
       (array['web','tiktok','instagram','x','youtube'])[1 + floor(random()*5)::int],
       now() - (random() * interval '6 days')
from songs s
cross join lateral generate_series(1, greatest(3, 64 - (s.id * 3))) g;

-- Opening lounge message.
insert into lounge_messages (name, body, is_crew)
values ('Romeo','Lines are open. You pick every song tonight.', true);
