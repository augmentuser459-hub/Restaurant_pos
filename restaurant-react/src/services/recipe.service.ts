import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll, fetchByIds } from '../lib/fetchAll'
import { roundMoney, roundQuantity } from '../lib/utils'
import { Item, RecipeIngredient, ProductionLog } from '../types/database.types'

/** A unit with its conversion: base_unit_id NULL = it is its own base; factor_to_base = base units in one of it */
export interface RecipeUnit {
  id: string
  code: string
  name_ar: string
  base_unit_id: string | null
  factor_to_base: number
}

export type RecipeIngredientRow = Omit<RecipeIngredient, 'ingredient' | 'unit'> & {
  ingredient?: (Item & { unit?: RecipeUnit | null }) | null
  unit?: RecipeUnit | null
}

export interface RecipeWithIngredients extends Omit<Item, 'unit'> {
  unit?: { id: string; name_ar: string; code: string } | null
  ingredients: RecipeIngredientRow[]
}

export interface SaveRecipeData {
  code: string | null // empty = generated (RCP-YYYYMM-00001)
  name: string
  name_ar: string
  description?: string
  unit_id: string
  category_id: string | null // null = the 'CAT-RECIPE' category when it exists
  min_stock_level?: number
  ingredients: {
    ingredient_item_id: string
    quantity: number
    unit_id: string | null
    notes?: string
  }[]
}

export interface ProduceRecipeData {
  recipe_item_id: string
  branch_id: string
  quantity: number
  notes?: string
  request_id: string // same id on a retry = the database does not produce twice
}

export interface AvailabilityDetail {
  item_id: string
  name: string
  required: number
  available: number
  sufficient: boolean
  unit: string
}

const UNIT_COLUMNS = 'id, name_ar, code, base_unit_id, factor_to_base'

const INGREDIENT_SELECT = `
  id,
  recipe_item_id,
  ingredient_item_id,
  quantity,
  unit_id,
  notes,
  created_at,
  updated_at,
  ingredient:items!ingredient_item_id(id, code, name_ar, unit_id, purchase_price, unit:units(${UNIT_COLUMNS})),
  unit:units(${UNIT_COLUMNS})
`

/**
 * How many `to` units are in one `from` unit (g -> kg = 0.001), or null when they cannot be converted.
 * A missing unit means "the item's own stock unit". Mirrors recipe_unit_factor() in the database.
 */
export function unitFactor(from: RecipeUnit | null | undefined, to: RecipeUnit | null | undefined): number | null {
  if (!from || !to || from.id === to.id) return 1
  if ((from.base_unit_id || from.id) !== (to.base_unit_id || to.id)) return null
  return Number(from.factor_to_base || 1) / Number(to.factor_to_base || 1)
}

/** Quantity of one recipe ingredient line expressed in the ingredient's stock unit (what stock and purchase_price use) */
export function ingredientStockQuantity(ing: RecipeIngredientRow): number {
  const factor = unitFactor(ing.unit, ing.ingredient?.unit) ?? 1
  return Number(ing.quantity || 0) * factor
}

/** Cost of one recipe unit: every ingredient converted to its stock unit times its purchase price */
export function computeRecipeCost(ingredients: RecipeIngredientRow[]): number {
  return roundMoney(ingredients.reduce(
    (total, ing) => total + ingredientStockQuantity(ing) * Number(ing.ingredient?.purchase_price || 0), 0))
}

function normalizeIngredients(rows: Record<string, unknown>[]): RecipeIngredientRow[] {
  // Supabase may return single relations as arrays
  return rows.map(ing => ({
    ...ing,
    ingredient: Array.isArray(ing.ingredient) ? ing.ingredient[0] : ing.ingredient,
    unit: Array.isArray(ing.unit) ? ing.unit[0] : ing.unit,
  })) as unknown as RecipeIngredientRow[]
}

/** RFC 4122 v4 id from crypto.getRandomValues (crypto.randomUUID is missing on plain-http LAN pages) */
export function newRequestId(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const recipeService = {
  // Get all recipes (items with is_recipe = true)
  async getAllRecipes() {
    try {
      const rows = await fetchAll<Item>((from, to) =>
        supabase
          .from('items')
          .select('*, category:categories(name_ar), unit:units(id, name_ar, code)')
          .eq('is_recipe', true)
          .order('name_ar')
          .order('id')
          .range(from, to))
      return { data: fixEncodingInData(rows) as Item[], error: null }
    } catch (error) {
      return { data: [] as Item[], error }
    }
  },

  // Get all recipes with their cost per unit (all ingredients loaded in one go, units converted)
  async getAllRecipesWithCost() {
    const { data: recipes, error } = await this.getAllRecipes()
    if (error) return { data: [] as (Item & { calculated_cost: number })[], error }

    try {
      const rows = await fetchByIds<Record<string, unknown>>(recipes.map(r => r.id), (ids, from, to) =>
        supabase
          .from('recipe_ingredients')
          .select(INGREDIENT_SELECT)
          .in('recipe_item_id', ids)
          .order('id')
          .range(from, to))
      const byRecipe = new Map<string, RecipeIngredientRow[]>()
      normalizeIngredients(rows).forEach(ing => {
        const list = byRecipe.get(ing.recipe_item_id) || []
        list.push(ing)
        byRecipe.set(ing.recipe_item_id, list)
      })
      const recipesWithCost = recipes.map(recipe => ({
        ...recipe,
        calculated_cost: computeRecipeCost(byRecipe.get(recipe.id) || []),
      }))
      return { data: recipesWithCost, error: null }
    } catch (ingError) {
      return { data: recipes.map(r => ({ ...r, calculated_cost: 0 })), error: ingError }
    }
  },

  // Get recipe with ingredients
  async getRecipeWithIngredients(recipeItemId: string) {
    const [recipeRes, ingredientsRes] = await Promise.all([
      supabase
        .from('items')
        .select('*, category:categories(name_ar), unit:units(id, name_ar, code)')
        .eq('id', recipeItemId)
        .eq('is_recipe', true)
        .single(),
      supabase
        .from('recipe_ingredients')
        .select(INGREDIENT_SELECT)
        .eq('recipe_item_id', recipeItemId)
        .order('created_at')
        .order('id')
    ])

    if (recipeRes.error) return { data: null, error: recipeRes.error }
    if (ingredientsRes.error) return { data: null, error: ingredientsRes.error }

    const recipe = fixEncodingInData(recipeRes.data) as RecipeWithIngredients
    recipe.ingredients = fixEncodingInData(normalizeIngredients(ingredientsRes.data || [])) as RecipeIngredientRow[]
    return { data: recipe, error: null }
  },

  // Units with their conversion data
  async getUnits() {
    const { data, error } = await supabase
      .from('units')
      .select(UNIT_COLUMNS)
      .eq('is_active', true)
      .order('name_ar')
    return { data: (fixEncodingInData(data) as RecipeUnit[]) || [], error }
  },

  // Active categories (a recipe belongs to one, e.g. the POS menu group it is sold under)
  async getCategories() {
    const { data, error } = await supabase
      .from('categories')
      .select('id, code, name_ar')
      .eq('is_active', true)
      .order('name_ar')
    return { data: (fixEncodingInData(data) as { id: string; code: string; name_ar: string }[]) || [], error }
  },

  // Creates (no id) or updates a recipe and replaces all its ingredients, in one database transaction
  async saveRecipe(recipeItemId: string | null, recipeData: SaveRecipeData) {
    const { data, error } = await supabase.rpc('recipe_save', {
      p_recipe_item_id: recipeItemId,
      p_code: recipeData.code || null,
      p_name: recipeData.name || null,
      p_name_ar: recipeData.name_ar,
      p_unit_id: recipeData.unit_id,
      p_category_id: recipeData.category_id || null,
      p_ingredients: recipeData.ingredients.map(ing => ({
        ingredient_item_id: ing.ingredient_item_id,
        quantity: roundQuantity(ing.quantity),
        unit_id: ing.unit_id || null,
        notes: ing.notes || null,
      })),
      p_description: recipeData.description || null,
      p_min_stock_level: recipeData.min_stock_level ?? 0,
    })
    return { data: data as { id: string; code: string } | null, error }
  },

  // Produce recipe: deducts every ingredient (converted to its stock unit) and adds the recipe, all or nothing
  async produceRecipe(data: ProduceRecipeData) {
    const { data: result, error } = await supabase.rpc('recipe_produce', {
      p_recipe_item_id: data.recipe_item_id,
      p_branch_id: data.branch_id,
      p_quantity: roundQuantity(data.quantity),
      p_notes: data.notes || null,
      p_request_id: data.request_id,
    })
    return { data: result as { id: string; production_number: string; duplicate: boolean } | null, error }
  },

  // Get production logs, newest first (filtered in the query, so the limit applies to the chosen recipe/branch)
  async getProductionLogs(options: { branchId?: string; recipeId?: string; limit?: number } = {}) {
    let query = supabase
      .from('production_logs')
      .select('*, recipe:items(id, code, name_ar), branch:branches(id, name_ar)')
      .order('produced_at', { ascending: false })
      .order('id')
      .limit(options.limit ?? 50)

    if (options.branchId) {
      query = query.eq('branch_id', options.branchId)
    }
    if (options.recipeId) {
      query = query.eq('recipe_item_id', options.recipeId)
    }

    const { data, error } = await query
    return { data: (fixEncodingInData(data) as ProductionLog[]) || [], error }
  },

  // Get Recipe category ID (null when the category does not exist)
  async getRecipeCategoryId() {
    const { data } = await supabase
      .from('categories')
      .select('id')
      .in('code', ['CAT-RECIPE', 'RECIPE'])
      .order('code')
      .limit(1)
      .maybeSingle()

    return data?.id || null
  },

  // Stock check preview for producing `quantity` units in a branch (the database repeats it on production)
  async checkIngredientAvailability(ingredients: RecipeIngredientRow[], branchId: string, quantity: number) {
    if (!ingredients.length) return { available: false, details: [] as AvailabilityDetail[], error: null }

    try {
      const stockRows = await fetchByIds<{ item_id: string; quantity: number }>(
        ingredients.map(i => i.ingredient_item_id),
        (ids, from, to) =>
          supabase.from('inventory').select('item_id, quantity').eq('branch_id', branchId).in('item_id', ids).order('id').range(from, to))
      const stock = new Map(stockRows.map(r => [r.item_id, Number(r.quantity) || 0]))

      // The same ingredient on two lines is required once, summed
      const required = new Map<string, number>()
      ingredients.forEach(ing => {
        required.set(ing.ingredient_item_id, (required.get(ing.ingredient_item_id) || 0) + ingredientStockQuantity(ing) * quantity)
      })

      const details: AvailabilityDetail[] = [...required.entries()].map(([itemId, qty]) => {
        const ing = ingredients.find(i => i.ingredient_item_id === itemId)
        const need = roundQuantity(qty)
        const available = roundQuantity(stock.get(itemId) || 0)
        return {
          item_id: itemId,
          name: ing?.ingredient?.name_ar || '',
          required: need,
          available,
          sufficient: available >= need,
          unit: ing?.ingredient?.unit?.name_ar || '',
        }
      })
      return { available: details.every(d => d.sufficient), details, error: null }
    } catch (error) {
      return { available: false, details: [] as AvailabilityDetail[], error }
    }
  },

  // Every item with the fields the CSV import needs (all pages)
  async getItemsForImport() {
    try {
      const rows = await fetchAll<{ id: string; code: string; name_ar: string; unit_id: string; is_recipe: boolean | null; status: string }>(
        (from, to) => supabase.from('items').select('id, code, name_ar, unit_id, is_recipe, status').order('id').range(from, to))
      return { data: fixEncodingInData(rows) as typeof rows, error: null }
    } catch (error) {
      return { data: [] as { id: string; code: string; name_ar: string; unit_id: string; is_recipe: boolean | null; status: string }[], error }
    }
  },
}
