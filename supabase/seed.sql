-- QA seed data for M Coffee store-specific questions.
-- Store and question identifiers/timestamps use database defaults where applicable.

insert into public.stores (id, store_name)
select seed.id, seed.store_name
from (
  values
    (
      '57181130-4449-4299-a864-25a2098147e4'::uuid,
      'M Coffee 이수점'
    ),
    (
      'f9bc865b-5722-40b3-8548-1c181f5ad7fb'::uuid,
      'M Coffee 숭실대점'
    )
) as seed(id, store_name)
where not exists (
  select 1
  from public.stores as existing_store
  where existing_store.id = seed.id
);

insert into public.questions (
  store_id,
  question,
  question_type,
  expected_category,
  expected_answer
)
select
  store.id,
  qa.question,
  qa.question_type,
  qa.expected_category,
  qa.expected_answer
from (
  values
    (
      '57181130-4449-4299-a864-25a2098147e4'::uuid,
      '이수점은 평일에 언제부터 언제까지 하나요?',
      '기본 질문',
      '지점운영',
      '이수점의 평일 영업시간은 오전 9시부터 오후 10시까지입니다.'
    ),
    (
      '57181130-4449-4299-a864-25a2098147e4'::uuid,
      '이수점에서 딸기청은 어디 보관되어 있나요?',
      '기본 질문',
      '재고/발주',
      '딸기청은 냉장고 오른쪽 두 번째 선반에 보관합니다.'
    ),
    (
      '57181130-4449-4299-a864-25a2098147e4'::uuid,
      '이수점 커피머신은 어디에 있나요?',
      '기본 질문',
      '장비관리',
      '커피 머신은 제조대 왼쪽에 있습니다.'
    ),
    (
      '57181130-4449-4299-a864-25a2098147e4'::uuid,
      '이수점은 평일 중 언제 손님이 제일 많이 몰리나요?',
      '기본 질문',
      '지점운영',
      '평일 12시부터 14시까지와 오후 16시부터 18시까지 주문이 증가할 수 있습니다.'
    ),
    (
      '57181130-4449-4299-a864-25a2098147e4'::uuid,
      '이수점 비품 위치가 바뀐 것 같은데 예전 위치대로 그냥 써도 되나요?',
      '판단 필요',
      '장비관리',
      '현재 매뉴얼만으로 정확한 위치 변경 여부를 판단할 수 없으므로 임의로 옮기지 말고 사장님 또는 매니저에게 확인해야 합니다.'
    ),
    (
      'f9bc865b-5722-40b3-8548-1c181f5ad7fb'::uuid,
      '숭실대점은 주말에 언제부터 문 여나요?',
      '기본 질문',
      '지점운영',
      '숭실대점은 주말 오전 9시에 영업을 시작합니다.'
    ),
    (
      'f9bc865b-5722-40b3-8548-1c181f5ad7fb'::uuid,
      '숭실대점에서 원두는 어디 보관하나요?',
      '기본 질문',
      '재고/발주',
      '원두는 제조대 아래쪽의 지정된 보관 공간에 보관합니다.'
    ),
    (
      'f9bc865b-5722-40b3-8548-1c181f5ad7fb'::uuid,
      '숭실대점 제빙기는 어디에 있나요?',
      '기본 질문',
      '장비관리',
      '제빙기는 제조대 오른쪽에 있습니다.'
    ),
    (
      'f9bc865b-5722-40b3-8548-1c181f5ad7fb'::uuid,
      '숭실대점은 하루 중 언제 학생 손님이 많아지나요?',
      '기본 질문',
      '지점운영',
      '오후 17시부터 20시까지 학생과 포장 주문이 증가할 수 있습니다.'
    ),
    (
      'f9bc865b-5722-40b3-8548-1c181f5ad7fb'::uuid,
      '숭실대점 오픈 근무자는 영업 시작 전에 언제까지 출근해야 하나요?',
      '기본 질문',
      '지점운영',
      '영업 시작 30분 전까지 출근합니다. 평일은 오전 7시 30분, 주말은 오전 8시 30분까지입니다.'
    )
) as qa(store_id, question, question_type, expected_category, expected_answer)
join public.stores as store on store.id = qa.store_id
where not exists (
  select 1
  from public.questions as existing_question
  where existing_question.store_id = qa.store_id
    and existing_question.question = qa.question
);